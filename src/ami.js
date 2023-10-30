const AMI = require('yana');
require("dotenv/config");
class Ami {
    constructor(events = true) {
        const params = {
            events,
            login: process.env.AMI_USER,
            password: process.env.AMI_PASSWORD,
            host: process.env.AMI_HOST,
            port: process.env.AMI_PORT,
            reconnect: true
        }
        this.ami = new AMI(params)
        this.setupAMIListeners();
        // this.setupAMIActions()
        this.connectToAMI();
        // this.ami.connect().then(() => console.log(`AMI Connected to host ${params.host}:${params.port}`));
        // this.ami.on('Hangup', () => console.log(`Chamada Desligada ${params.host}:${params.port}`));
        // this.ami.on('PeerStatus', (event) => this.handlePeerStatus(event));
        // this.ami.on('Hangup', (event) => this.handleHangup(event))
        this.dataAmi = {}
    }
    
    setupAMIListeners() {
        this.ami.on('Hangup', () => console.log(`Chamada Desligada ${this.ami.options.host}:${this.ami.options.port}`));
        this.ami.on('PeerStatus', (event) => this.handlePeerStatus(event));
    }

    async connectToAMI() {
    try {
        await this.ami.connect();
        console.log(`AMI Connected to host ${this.ami.options.host}:${this.ami.options.port}`);
        
    } catch (err) {
        console.error(`Error connecting to AMI: ${err}`);
    }
}



handlePeerStatus(event) {
    const {peerstatus, peer, address} = event
    // const peerstatusTeste = peerstatus.toUpperCase()
    
    this.dataAmi.date = new Date()
    this.dataAmi.ramal = peer
    this.dataAmi.status = peerstatus
    this.dataAmi.ip = address
    
    
    console.log(this.dataAmi)
}
    handleHangup(event) {
        const {channel, uniqueid} = event
        const endpoint = `${channel || ''}`.replace(/-.*/, '')
        
        console.log(event, endpoint)
    }
    
    sipShowPeers(callback) {
        this.ami.send({Action: 'Command', Command: 'sip show peers'}, (err, response) => {
            if(!err) {
                const {output} = response
                const headers = output[0].split(/\s+/)
                const peers = []
                console.log(headers)
                for(let i = 1; i < output.length; i++){
                    const row = output[i].split(/\s+/)
                    const entry = {}
                    for(let j = 0; j < headers.length; j++){
                        entry[headers[j]] = row[j]
                    }
                    peers.push(entry)
                    
                }
                
                callback(null, peers)
            } else {
                callback(err, null)
            }
        })
    }
    sip
    
    
    
}

module.exports = Ami