const Ami = require('../ami')
const amiInstance = new Ami();
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
                data.peers = response
                res.status(202).json({data})
            }
        })
    }
}   