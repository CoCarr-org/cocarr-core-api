const {format,createLogger,transports,addColors} = require("winston");
const { combine, timestamp, label, printf } = format;


const myCustomLevels = {
    levels: {'error': 0,'warn': 1,'info': 2,debug: 3,verbose:4},
    colors: {
      error: 'red',
      warn: 'orange',
      info: 'blue',
      debug: 'blue',
      verbose:'orange'
    }
  };
 
  
  const myFormat = printf(({ level, message, timestamp }) => {
    return `${timestamp}-${level}-${message}`;
  });

const logConfiguration = {
    transports:[
        new transports.Console(),
        new transports.File({
            filename:'logs/logFile.log'
        })
    ],
    format:combine(timestamp(),myFormat),
    levels:myCustomLevels.levels
}


const Logger = createLogger(logConfiguration)

module.exports =  Logger;