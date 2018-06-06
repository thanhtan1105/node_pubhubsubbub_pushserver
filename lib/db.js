'use strict'

const helper = require('./helper')
const debug = require('debug')('pushserver:db')
const _ = require('lodash')
const mongoose = require('mongoose')

// Use native promises
// http://mongoosejs.com/docs/promises.html
mongoose.Promise = global.Promise

exports = module.exports = function (config) {
  let isConnecting = true
  let isConnected = false

  const mongoUri = helper.appendNodeEnv(config.db.mongoUri)
  const connection = mongoose.createConnection(mongoUri, function (err) {
    if (err) {
      debug('Error connecting', mongoUri, err)
    } else {
      db.devices = require('./db/Device')(connection)
      db.hubs = require('./db/Hub')(connection)
      db.projects = require('./db/Project')(connection)

      isConnected = true
      debug('Connected', mongoUri)
    }

    isConnecting = false
  })

  const db = {
    expressMiddleware: function () {
      return setupMongoExpress(mongoUri)
    },

    isConnecting: function () {
      return isConnecting
    },

    isConnected: function () {
      return isConnected
    },

    closeConnection: function () {
      debug('Closing connection…')
      return connection.close()
        .catch((error) => debug(error))
    },

    stats: function () {
      return Promise.all([
        db.devices.stats(),
        db.hubs.stats(),
        db.projects.stats()
      ]).then(function (collections) {
        const db = {}

        _.forEach(collections, (collection) => {
          _.merge(db, collection)
        })

        return {db}
      })
    }
  }

  return db
}

const setupMongoExpress = function (mongoUri) {
  const mongoExpress = require('mongo-express/lib/middleware')
  const mec = helper.prepareMongoExpressConfig(mongoUri)

  return mongoExpress(mec)
}
