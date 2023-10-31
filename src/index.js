const express = require("express");
const routes = require('./routes')
const bodyParser = require("body-parser");
const Ami = require('./app/ami')




const app = express();
app.use(bodyParser.json());
app.use(routes);
// const amiInstance = new Ami();


try {
	app.listen(5000);
	console.log("[WARNING] " + 'API-ASTERISK' + " ON NA PORTA " + 5000);
} catch (error) {
	console.log("ERRO AO INICIAR O SERVIDOR NA PORTA " + 5000 + " - " + error.message);
}



