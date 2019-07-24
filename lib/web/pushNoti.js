'use strict'

const pushNoti = exports
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

pushNoti.setup = function (
  app,
  prefix,
  username,
  password,
  db,
  pushQueueFcm,
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
    pushNoti.setupProjects(app, prefix, db, pushQueueFcm)
  }

  return pushNoti
}

pushNoti.setupProjects = function (app, prefix, db, pushQueueFcm) {
  sections[prefix].push('projects')

  app.get(prefix + '/push', function (req, res) {
    stats.callback.get++

    const parsed = url.parse(req.url, true)

    if (!parsed.query.client_id) {
      debug('GET /push', '`client_id` is missing')
      return res.sendStatus(401)
    }
    const clientId = parsed.query.client_id

    if (!parsed.query['hub.challenge']) {
      debug('GET /push', '`hub.challenge` is missing')
      return res.sendStatus(403)
    }

    if (!parsed.query['hub.mode']) {
      debug('GET /push', '`hub.mode` is missing')
      return res.sendStatus(404)
    }
    const hubMode = parsed.query['hub.mode']

    const hubTopic = parsed.query['hub.topic'] || ''

    db.devices.findDevices(clientId, hubTopic, function (devices) {
      const isSubscribe = (hubMode === 'subscribe')
      const devicesFound = devices.length > 0

      if (isSubscribe !== devicesFound) {
        debug('GET /push', 'Devices not found', clientId, hubTopic)
        return res.sendStatus(405)
      }

      return res.send(parsed.query['hub.challenge'])
    })
  })

  if (!pushQueueFcm) {
    return
  }

  /*
    [
      {
      "client_id" : "123123",
      "topic" : "!23123",
      "object_data" : "1233213"
      },
      {
      "client_id" : "12321",
      "topic" : "!13213",
      "object_data" : "4124"
      },
      {
      "client_id" : "43243",
      "topic" : "!234324",
      "object_data" : "23423"
      }
    ],
  */
  app.post(prefix + '/push', function (req, res) {
    stats.callback.post++

    let error = false
  
    _.forEach(req.body, function (ping) {
      if (!_.isObject(ping)) {
        debug('POST /push', 'Unexpected data in callback', ping)
        error = true
        return false
      }
      
      const requiredKeys = ['client_id', 'topic', 'object_data']
      if (!_.every(requiredKeys, _.partial(_.has, ping))) {
        debug('POST /push', 'Insufficient data', _.keys(ping))
        error = true
        return false
      }
      
      db.devices.findDevices(
        ping.client_id,
        ping.topic,
        function (devices) {
          console.log('1')
          if (devices.length === 0) {
            pushNoti._findHubToUnsubscribe(
              ping.client_id,
              ping.topic,
              db,
              pushNoti._getPushUri(req, prefix),
              function (err) {
                debug('POST /push', 'Devices not found',
                  ping.client_id, ping.topic, err)
              }
            )
            return
          }

          console.log('2')
          const deviceGroups = []
          _.forEach(devices, function (device) {
            let addedToGroup = false
            _.forEach(deviceGroups, function (deviceGroup) {
              if (deviceGroup.type !== device.device_type) {
                return
              }
              console.log('3')
              if (!_.isEqual(deviceGroup.data, device.extra_data)) {
                return
              }

              deviceGroup.ids.push(device.device_id)
              addedToGroup = true
              return false
            })

            console.log('4')
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

          console.log('5')
          _.forEach(deviceGroups, function (deviceGroup) {
            pushQueueFcm.enqueue(
              deviceGroup.type,
              deviceGroup.ids,
              ping.object_data,
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

  return pushNoti
}

pushNoti._getPushUri = function (req, prefix) {
  if (config.web.callback) {
    return config.web.callback
  }

  return req.protocol + '://' + req.get('host') + prefix + '/push'
}

pushNoti._findHubToUnsubscribe = function (
  oauthClientId,
  hubTopic,
  db,
  callbackUri,
  callback
) {
  const findHub = function () {
    db.hubs.findHub(oauthClientId, function (hub) {
      if (hub === null) {
        return done('Hub not found')
      }

      unsubscribe(hub)
    })
  }

  const unsubscribe = function (hub) {
    let count = hub.hub_uri.length

    _.forEach(hub.hub_uri, function (hubUri) {
      request.post({
        url: hubUri,
        form: {
          'hub.callback': callbackUri,
          'hub.mode': 'unsubscribe',
          'hub.topic': hubTopic,
          'client_id': oauthClientId
        }
      }, function (err, httpResponse, body) {
        if (httpResponse) {
          const success = _.inRange(httpResponse.statusCode, 200, 300)
          const txt = success ? 'succeeded' : (body || 'failed')
          if (txt !== 'succeeded') {
            err = 'failed'
          }

          stats.auto_unsubscribe++
          debug('Auto-unsubscribe', hubUri, hubTopic, txt)
        } else {
          debug('Error auto-unsubscribe', hubUri, hubTopic, err)
        }

        count--
        if (count === 0) {
          if (hub.hub_uri.length === 1) {
            done(err)
          } else {
            done()
          }
        }
      })
    })
  }

  const done = helper.later(callback)

  findHub()
}
