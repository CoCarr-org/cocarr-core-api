const { Sequelize } = require('sequelize');
const Logger = require('../helper/logger');

// const db = new Sequelize('infanlce_cocarr', 'infanlce_cocarr', 'Cocarr@admin', {
//   host: '103.50.163.157',
//   port:3306,
//   dialect: 'mysql',
//   logging:false
// });
const db = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASS, {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql',
  logging:false,
  hooks: {
    // The vehicle-search query aggregates (distance) with non-grouped columns,
    // which MySQL rejects under ONLY_FULL_GROUP_BY (enabled by default on some
    // hosts) — causing empty search results. Drop it from the session sql_mode
    // on connect so those queries run as the app expects.
    afterConnect: (connection) => new Promise((resolve, reject) => {
      connection.query(
        "SET SESSION sql_mode = (SELECT REPLACE(@@sql_mode, 'ONLY_FULL_GROUP_BY', ''))",
        (err) => (err ? reject(err) : resolve())
      );
    }),
  },
});

db.authenticate()
  .then(() => Logger.info('Connection has been established successfully.'))
  .catch(err => Logger.error(`Unable to connect to the database:${err}`));


module.exports = db;