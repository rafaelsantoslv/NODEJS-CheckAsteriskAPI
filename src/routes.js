const express = require("express");
const controller = require("./app/Controllers/controller");
const routes = express.Router();


routes.post("/", (req, res) => {
	return res.status(200).json({
		message: 'conectado',
		statusCode: "200",
		
	});
});

routes.get("/sip", controller.SipShowPeers)
// routes.get("/ramais", controller.SipShowPeers)

module.exports = routes;