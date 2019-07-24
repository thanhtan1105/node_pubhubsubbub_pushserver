'use strict'

const tinhte = exports
const basicAuth = require('basic-auth')
const debug = require('debug')('pushserver:web:admin')
const _ = require('lodash')
const url = require('url')
const helper = require('../helper')
const sections = {}

const stats = {
  subscribe: 0,
  unsubscribe: 0,
  unregister: 0,
  callback: {
    get: 0,
    post: 0
  },
  auto_unsubscribe: 0
}

tinhte.setup = function (
  app,
  prefix,
  username,
  password,
  db,
  pushQueueTinhte,
  _sections
) {
  sections[prefix] = []

  if (username && password) {
    const requireAuth = function (req, res, next) {
      const unauthorized = function (res) {
        res.set('WWW-Authenticate', 'Basic realm=Authorization Required')
        return res.sendStatus(401)
      }

      const user = basicAuth(req)
      if (!user || !user.name || !user.pass) {
        return unauthorized(res)
      }

      if (user.name === username &&
              user.pass === password) {
        return next()
      } else {
        return unauthorized(res)
      }
    }
    app.use(prefix, requireAuth)
  }

  if (db) {
    tinhte.setupProjects(app, prefix, db, pushQueueTinhte)
  }

  return tinhte
}

tinhte.setupProjects = function (app, prefix, db, pushQueueTinhte) {
  sections[prefix].push('projects')

  if (!pushQueueTinhte) {
    return
  }

  /*
    [
      {
        "client_id" : "xxx",
        "topic" -> theo format "user_notification_2",
        "payload" 
      }
    ]
  */
  app.post(prefix + '/fcm-push', function (req, res) {
    stats.callback.post++

    let error = false
  
    _.forEach(req.body, function (ping) {
      if (!_.isObject(ping)) {
        debug('POST /push', 'Unexpected data in callback', ping)
        error = true
        return false
      }
      const requiredKeys = ['client_id', 'payload']
      if (!_.every(requiredKeys, _.partial(_.has, ping))) {
        debug('POST /tinhte/fcm-push', 'Insufficient data', _.keys(ping))
        error = true
        return false
      }
      
      ping.topic = 'user_notification_' + ping.client_id;

      db.devices.findDevices(
        ping.client_id,
        ping.topic,
        function (devices) {
          if (devices.length === 0) {
            return
          }

          const deviceGroups = []
          _.forEach(devices, function (device) {
            let addedToGroup = false
            _.forEach(deviceGroups, function (deviceGroup) {
              if (deviceGroup.type !== device.device_type) {
                return
              }

              if (!_.isEqual(deviceGroup.data, device.extra_data)) {
                return
              }

              deviceGroup.ids.push(device.device_id)
              addedToGroup = true
              return false
            })

            if (addedToGroup) {
              return
            }
            const newDeviceGroup = {
              type: device.device_type,
              ids: [device.device_id],
              data: device.extra_data
            }
            deviceGroups.push(newDeviceGroup)
          })
          _.forEach(deviceGroups, function (deviceGroup) {
            pushQueueTinhte.enqueue(
              deviceGroup.type,
              deviceGroup.ids,
              ping.payload,
              _.merge({
                _ping__client_id: ping.client_id,
                _ping__topic: ping.topic
              }, deviceGroup.data)
            )
          })
        })
    })

    return res.sendStatus(error ? 200 : 202)
  })

  return tinhte
}