const Ami = require('./ami')
const amiInstance = new Ami();
const printRes = require('./functions');
module.exports = {
    async SipShowPeers(req, res) {
        let data = {}
        amiInstance.sipShowPeers((err, response) => {
            if(err) {
                res.status(401).json({
                    status: '501',
                    message: err
                })
            }else {
                data.Peers = response
                res.status(201).json({
                    data
                })
            }
        }) 
    }
}   