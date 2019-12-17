'use strict'

const tinhte = exports
const debug = require('debug')('pushserver:tinhte:web')
const _ = require('lodash')
const helper = require('../helper')

tinhte.setup = function (
  app,
  prefix,
  username,
  password,
  db,
  pushQueueTinhte
) {
  if (!username || !password || !db || !pushQueueTinhte) {
    return false
  }

  app.use(prefix, helper.requireAuth(username, password))

  /*
    {
      "client_id": ["client_id1", "client_id2"],
      "user_id": ["user_id1", "user_id2", "user_id3"],
      "payload": { "notification": { "title": "xxx" } }
    }
  */
  app.post(prefix + '/fcm-push', function (req, res) {
    let error = false
    const requiredKeys = ['client_id', 'payload', 'user_id']
    if (!_.every(requiredKeys, _.partial(_.has, req.body))) {
      debug('POST /tinhte/fcm-push', 'Insufficient data')
      error = true
      return false
    }
    _.forEach(req.body['client_id'], function (clientId) {
      let userIds = req.body['user_id'];
      _.forEach(userIds, function(userId) {
        let topic = 'user_notification_' + userId;

        db.devices.findDevices(
          clientId,
          topic,
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
                req.body['client_id'],
                _.merge({
                  _ping__client_id: clientId,
                  _ping__topic: topic
                }, deviceGroup.data)
              )
            })
          })
      })
    })

    return res.sendStatus(error ? 200 : 202)
  })

  return tinhte
}