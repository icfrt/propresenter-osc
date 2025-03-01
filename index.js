const WebSocket = require('ws')
const osc = require('osc')

if (!process.argv || process.argv.length < 8) {
    console.log('ProPresenter Resolume OSC listens to the Stage Display interface of ProPresenter and sends text to OSC.');
    console.log('')
    console.log('Usage:')
    const argv0 = process.pkg ? process.argv0 : (process.argv0 + ' ' + ((process.argv && process.argv.length) > 1 ? process.argv[1] : 'resolume-osc.js'))
    console.log(`  ${argv0} <propresenter-ip> <propresenter-port> <stagedisplay-password> <resolume ip> <resolume port> <resolume channel>`)
    console.log('')
    console.log('Parameters:')
    console.log('  - <propresenter-ip>         IP address of the Mac/PC running ProPresenter')
    console.log('  - <propresenter-port>       Port shown in the ProPresenter preferences dialog for network access')
    console.log('  - <stagedisplay-password>   Password set in the ProPresenter preferences dialog for Stage Display access')
    process.exit(1)
}

const config = {
    host: process.argv[2],
    port: process.argv[3],
    password: process.argv[4],
    resolumeIp: process.argv[5],
    resolumePort: process.argv[6],
    resolumeAddresses: (process.argv[7] || '').split(','),
    resolumeAddresses2: process.argv.length > 8 ? (process.argv[8] || '').split(',') : [],
}

function connectWs() {
    let wsClient = new WebSocket(`ws://${config.host}:${config.port}/stagedisplay`);

    wsClient.on('open', function open() {
        console.log(`Opened connection to: ${config.host}:${config.port}`);
        wsClient.send(JSON.stringify({
            pwd: config.password,
            ptl: 610,
            acn: 'ath'
        }));

    });

    wsClient.on('error', function (err) { 
        if (err && err.code !== 'ECONNREFUSED') {
            console.error(err)
        }
    });
    wsClient.on('connect', function () { console.log('Connection established'); });
    wsClient.on('close', function(_code, _reason) { console.log('Connection closed') });

    wsClient.on('message', function(message) { onMessage(message); });

    return wsClient;
}


let client = connectWs();
let sdLayoutUid = null;
let resolumeAddressSelect = false;

let reconnectTimer = setInterval(() => {
    if (!client || client.readyState === WebSocket.CLOSED) {
        console.log('Reconnecting...');
        if (client) client.close();
        delete client;
        client = connectWs();
    }
}
, 5000);

const oscClient = new osc.UDPPort({
    localAddress: "0.0.0.0",
    localPort: 57121,
});

oscClient.open();

// Listen for incoming OSC messages.
oscClient.on("message", function (oscMsg, timeTag, info) {
    console.log("An OSC message just arrived!", oscMsg);
    console.log("Remote info is: ", info);
});


function onMessage(message) {
	var objData = JSON.parse(message);
    // console.log(objData)
	switch(objData.acn) {
		case 'ath':
			if (objData.ath === true) {
                console.log('auth ok');

                //client.send(JSON.stringify({ acn: 'psl' }));
                client.send(JSON.stringify({ acn: 'asl' }));
			} else {
                console.log('auth error');
			}
			break;
        case 'asl':
            if (objData.ary && objData.ary.length > 0) {
                sdLayoutUid = objData.ary[0].uid;
                console.log('sdLayoutUid: ' + sdLayoutUid);
                
                // request curernt data
                client.send(JSON.stringify({ acn: 'fv', uid: sdLayoutUid }));
            }
            break;
        case 'psl':
            if (objData.uid) {
                sdLayoutUid = objData.uid;
                console.log('sdLayoutUid: ' + sdLayoutUid);
                
                // request curernt data
                client.send(JSON.stringify({ acn: 'fv', uid: sdLayoutUid }));
            }
            break;
        case 'fv':
            const cs = objData.ary.find(a => a.acn === 'cs')
            const csn = objData.ary.find(a => a.acn === 'csn')

            if (csn) {
                // prefere slide notes over slide text
                handleText(csn.txt)
            } else if (cs) {
                // fallback to slide text, if no notes are available
                handleText(cs.txt)
            }
            break
		default:
			break;
	}
};

/**
 * @param {String} text 
 */
function handleText(text) {
    if (!text) text = ''

    // transformations
    text = text.toUpperCase()

    sendOscMessage(text)
}

function sendOscMessage(text) {    
    try {
        let selectedAddress = config.resolumeAddresses[0];
        let additionalAddresses = config.resolumeAddresses.slice(1);

        // toggle address
        if (config.resolumeAddresses2 && config.resolumeAddresses2.length > 0) {
            if (resolumeAddressSelect) {
                selectedAddress = config.resolumeAddresses2[0];
                additionalAddresses = config.resolumeAddresses2.slice(1);
            }

            resolumeAddressSelect = !resolumeAddressSelect;
        }

        // console.log('Sending ' + selectedAddress)
        oscClient.send({
            address: selectedAddress,
            args: [ { type: "s", value: text } ]
        }, config.resolumeIp, parseInt(config.resolumePort));

        for (let i = 0; i < additionalAddresses.length; i++) {
            // console.log('Sending ' + additionalAddresses[i])
            oscClient.send({
                address: additionalAddresses[i],
                args: [ { type: "i", value: 1 } ]
            }, config.resolumeIp, parseInt(config.resolumePort));
        }

        console.log('TEXT (' + (resolumeAddressSelect ? '1' : '2') + '): ' + text)
    } catch (error) {
        console.error(error)
    }
}

process.on('SIGINT', function() {
    console.log('Caught interrupt signal');

    if (client) {
        client.close();
    }

    if (oscClient) {
        oscClient.close();
    }

    process.exit();
});