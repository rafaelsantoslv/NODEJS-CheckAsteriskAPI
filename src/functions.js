    var util = require('util');

    function printRes (err, res) {
        if (err) {
          console.log('action failed', err);
          return;
        }
      
        console.log('response to action: ' + util.inspect(res));
      }

    module.exports =  printRes;