'use strict'

/* eslint-disable no-unused-expressions */

const config = require('../lib/config')
const pusher = require('../lib/pusher')
const pushQueue = require('../lib/pushQueue')
const web = require('../lib/web')
const chai = require('chai')
const _ = require('lodash')
const nock = require('nock')

chai.should()
chai.use(require('chai-http'))
const expect = chai.expect
const db = require('./mock/db')
const pushKue = require('./mock/pushKue')

let server = null
let webApp = null
let pushNoti = null

const originalProcessEnv = _.merge({}, process.env)
const adminUsername = 'username'
const adminPassword = 'password'
const hubUri = 'https://xfrocks.com/api/index.php?subscriptions'
const hubTopic = 'user_notification_2'
const oauthClientId = 'gljf4391k3'
const oauthClientId2 = 'gljf4391k32'
const oauthToken = '83ae5ed7f9b0b5bb392af3f2f57dabf1ba3fe2e5'
const notificationId = 1
const notificationHtml = 'Hello.'
const apn = {
  bundleId: 'com.xfrocks.api.ios',
  token: {
    key: 'key',
    keyId: 'keyId',
    teamId: 'teamId'
  },
  deviceType: 'ios',
  deviceId: 'deviceId'
}

describe('app', function () {
  // eslint-disable-next-line no-invalid-this
  this.timeout(20000)

  before(function (done) {
    nock.disableNetConnect()
    nock.enableNetConnect('127.0.0.1')

    process.env = _.merge({}, originalProcessEnv)
    process.env.CONFIG_WEB_CALLBACK = 'https://api-pushserver-xfrocks-com.herokuapp.com/callback'
    process.env.CONFIG_WEB_USERNAME = adminUsername
    process.env.CONFIG_WEB_PASSWORD = adminPassword
    process.env.PORT = 0
    config._reload()
    config.pushQueue.attempts = 0

    db.hubs._reset()
    db.projects._reset()
    web._reset()
    pushNoti._reset()

    pushQueue.setup(pushKue, pusher.setupDefault(), db)
    server = web.start(db, pushQueue)
    webApp = chai.request(server).keepOpen()
    pushNoti = chai.request(server).keepOpen()

    done()
  })

  beforeEach(function (done) {
    db.devices._reset()

    nock('https://xfrocks.com')
      .post('/api/index.php?subscriptions')
      .reply(202)

    done()
  })

  after(function (done) {
    nock.cleanAll()
    nock.enableNetConnect()
    server.close()
    done()
  })

  it('should works with fcm', done => {
    const deviceId = 'firebase-di'
    const projectId = 'firebase-pi'

    const setup = () =>
      webApp
        .post('/push')
        .auth(adminUsername, adminPassword)
        .send([
          {
            client_id: oauthClientId,
            topic: hubTopic,
            object_data: {
              notification_id: notificationId,
              notification_html: notificationHtml
            }
          },
          {
            client_id: oauthClientId2,
            topic: hubTopic,
            object_data: {
              notification_id: notificationId,
              notification_html: notificationHtml
            }
          }
        ])
        .end((err, res) => {
          expect(err).to.be.null
          res.should.have.status(202)
          subscribe()
        })

    const subscribe = () =>
      webApp
        .post('/subscribe')
        .send({
          hub_uri: hubUri,
          hub_topic: hubTopic,
          oauth_client_id: oauthClientId,
          oauth_token: oauthToken,
          extra_data: {
            project: projectId
          },
          device_type: 'firebase',
          device_id: deviceId
        })
        .end((err, res) => {
          expect(err).to.be.null
          res.should.have.status(202)
          res.text.should.equal('succeeded')
          callback()
        })

    // const callback = () =>
    //   webApp
    //     .post('/callback')
    //     .send([
    //       {
    //         client_id: oauthClientId,
    //         topic: hubTopic,
    //         object_data: {
    //           notification_id: notificationId,
    //           notification_html: notificationHtml
    //         }
    //       }
    //     ])
    //     .end((err, res) => {
    //       expect(err).to.be.null
    //       res.should.have.status(202)
    //       setTimeout(verifyPushQueueStats, 100)
    //     })

    let queuedBefore = 0
    let processedBefore = 0
    const verifyPushQueueStats = () =>
      pushQueue.stats().then(stats => {
        stats.pushQueue.queued.should.equal(queuedBefore + 1)
        stats.pushQueue.processed.should.equal(processedBefore + 1)
        done()
      })

    pushQueue.stats().then(statsBefore => {
      queuedBefore = statsBefore.pushQueue.queued
      processedBefore = statsBefore.pushQueue.processed
      setup()
    })
  })
})