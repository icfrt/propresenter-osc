const WebSocket = require('ws')
const osc = require('osc')

const config = require('./config.json')

const debug_log = config.debug ? console.log : () => {};
const debug_log_rx = config.debugRx ? console.log : () => {};
const debug_log_tx = config.debugTx ? console.log : () => {};


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

// Create an osc client
const oscClient = new osc.UDPPort({ localAddress: "0.0.0.0", localPort: 57121 });
oscClient.open();

// Listen for incoming OSC messages.
oscClient.on("message", function (oscMsg, timeTag, info) {
    console.log("An OSC message just arrived!", oscMsg);
    console.log("Remote info is: ", info);
});


function onMessage(message) {
	var objData = JSON.parse(message);
    debug_log_rx(objData)
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
            const ns = objData.ary.find(a => a.acn === 'ns')
            const nsn = objData.ary.find(a => a.acn === 'nsn')

            // prefere slide notes over slide text
            const text = csn ? csn.txt : cs ? cs.txt : undefined
            const next_text = nsn ? nsn.txt : ns ? ns.txt : undefined

            if (text) {
                handleText(text, next_text)
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
    if (!text) text = '';
    else text = text.trim();

    // transformations
    text = text.toUpperCase()

    sendOscMessage(text)
}

const delayedUpdates = {
    [config.resolumeAddresses[0]]: null
};

const setTexts = {
    [config.resolumeAddresses[0]]: null
}

if (config.resolumeAddresses2 && config.resolumeAddresses2.length > 0) {
    delayedUpdates[config.resolumeAddresses2[0]] = null;
    setTexts[config.resolumeAddresses2[0]] = null;
}

function sendResolumeText(address, text) {
    debug_log_tx('Sending ' + address + ' ' + text)
    
    // Clear pending delayed acctions
    if (delayedUpdates[address] && delayedUpdates[address] !== null) {
        clearTimeout(delayedUpdates[address]);
        delayedUpdates[address] = null;
    }
    
    // send new values
    oscClient.send({
        address: address,
        args: [ { type: "s", value: text } ]
    }, config.resolumeIp, config.resolumePort);

    setTexts[address] = text;
}

function sendResolumeInt(address, value) {
    debug_log_tx('Sending ' + address + ' ' + value)
    oscClient.send({
        address: address,
        args: [ { type: "i", value: value } ]
    }, config.resolumeIp, config.resolumePort);
}

function sendOscMessage(text, next_text) {    
    try {
        let selectedAddress = config.resolumeAddresses[0];
        let additionalAddresses = config.resolumeAddresses.slice(1);
        let otherSelectedAddress = null;

        // toggle address
        if (config.resolumeAddresses2 && config.resolumeAddresses2.length > 0) {
            if (resolumeAddressSelect) {
                otherSelectedAddress = selectedAddress;
                selectedAddress = config.resolumeAddresses2[0];
                additionalAddresses = config.resolumeAddresses2.slice(1);
            } else {
                otherSelectedAddress = config.resolumeAddresses2[0];                
            }

            resolumeAddressSelect = !resolumeAddressSelect;
        }
  
        sendResolumeText(selectedAddress, text);

        if (next_text !== undefined && config.delayedUpdate && config.delayedUpdate > 0) {
            delayedUpdates[otherSelectedAddress] = setTimeout(
                () => sendResolumeText(otherSelectedAddress, next_text), 
                config.delayedUpdate);
        }

        for (let i = 0; i < additionalAddresses.length; i++) {
            let cmd = () => sendResolumeInt(additionalAddresses[i], 1);

            if (setTexts[selectedAddress] !== text && config.delyedSecondary && config.delyedSecondary > 0) {
                setTimeout(cmd, config.delyedSecondary);
            } else {
                cmd();
            }
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