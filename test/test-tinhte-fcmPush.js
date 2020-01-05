'use strict'

/* eslint-disable no-unused-expressions */

const config = require('../lib/config')
const pusher = require('../lib/pusher')
const pusherFcm = require('../lib/pusher/fcm')
const pushQueueTinhte = require('../lib/tinhte/fcmPush')
const pushQueue = require('../lib/pushQueue')
const web = require('../lib/web')
const chai = require('chai')
const _ = require('lodash')
const nock = require('nock')
const fcm = require('./mock/_modules-firebase-admin')

chai.should()
chai.use(require('chai-http'))
const expect = chai.expect
const db = require('./mock/db')
const pushKue = require('./mock/pushKue')

let server = null
let webApp = null
let tinhte = null

const originalProcessEnv = _.merge({}, process.env)
const adminUsername = 'username'
const adminPassword = 'password'
const hubUri = 'https://xfrocks.com/api/index.php?subscriptions'
const hubTopicUser1 = 'user_notification_1'
const hubTopicUser2 = 'user_notification_2'
const hubTopicUser3 = 'user_notification_3'
const oauthClientId = 'gljf4391k3'
const oauthClientId2 = 'gljf4391k32'
const oauthClientId3 = 'gljf4391k33'
const oauthToken = '83ae5ed7f9b0b5bb392af3f2f57dabf1ba3fe2e5'
const oauthToken2 = '83ae5ed7f9b0b5bb392af3f2f57dabf1ba3fe2e6'
const oauthToken3 = '83ae5ed7f9b0b5bb392af3f2f57dabf1ba3fe2e7'
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
const projectConfig = {
  client_email: 'ce',
  private_key: 'pk'
}
const registrationToken = 'rt'


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

    pushQueueTinhte.setup(pushKue, pusher.setup(null, fcm, null, null), db)
    pushQueue.setup(pushKue, pusher.setup(null, fcm, null, null), db)
    server = web.start(db, pushQueue, pushQueueTinhte);
    
    webApp = chai.request(server).keepOpen()
    tinhte = chai.request(server).keepOpen()

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

  it('should works with fcm 1 oauthClientId and 1 user_id', done => {
    const deviceId = 'firebase-di'
    const projectId = 'firebase-pi'

    const setup = () =>
      webApp
        .post('/admin/projects/fcm')
        .auth(adminUsername, adminPassword)
        .send({
          project_id: projectId,
          client_email: 'user@domain.com',
          private_key: '-----BEGIN RSA PRIVATE KEY-----\nMGUCAQACEQDZ9yHDjBHwQKkk+I3pfVeVAgMBAAECEQCw9uXR1zJlRQoGH0SKmPiB\nAgkA+w3y/vic1aECCQDeQlECbNmVdQIJAJPvYlLweKpBAgkAqBpAazUo3IECCQDj\nX4gCHu8E+w==\n-----END RSA PRIVATE KEY-----'
        })
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
          hub_topic: hubTopicUser1,
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
    const callback = () =>
      webApp
      .post('/tinhte/fcm-push')
      .auth(adminUsername, adminPassword)
      .send(
        {
          client_id: [oauthClientId],
          user_id: [1],
          payload: { notification: { title: 'xxx' } }
        }
      )
      .end((err, res) => {        
        expect(err).to.be.null
        res.should.have.status(202)
        // done()
        setTimeout(verifyPushQueueStats, 100)
      })

      let queuedBefore = 0
      let processedBefore = 0
      const verifyPushQueueStats = function () {
        pushQueueTinhte.stats().then(stats => {
          stats.pushQueueTinhte.queued.should.equal(queuedBefore + 1)
          stats.pushQueueTinhte.processed.should.equal(processedBefore + 1)
          done()
        })
      }
      
      pushQueueTinhte.stats().then(statsBefore => {
        queuedBefore = statsBefore.pushQueueTinhte.queued
        processedBefore = statsBefore.pushQueueTinhte.processed
        setup()
      })
  })

  it('should works with fcm 1 oauthClientId and multiple user_id ', done => {
    const deviceId = 'firebase-di'
    const projectId = 'firebase-pi'

    const setup = () =>
      webApp
        .post('/admin/projects/fcm')
        .auth(adminUsername, adminPassword)
        .send({
          project_id: projectId,
          client_email: 'user@domain.com',
          private_key: '-----BEGIN RSA PRIVATE KEY-----\nMGUCAQACEQDZ9yHDjBHwQKkk+I3pfVeVAgMBAAECEQCw9uXR1zJlRQoGH0SKmPiB\nAgkA+w3y/vic1aECCQDeQlECbNmVdQIJAJPvYlLweKpBAgkAqBpAazUo3IECCQDj\nX4gCHu8E+w==\n-----END RSA PRIVATE KEY-----'
        })
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
          hub_topic: hubTopicUser1,
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
    const callback = () =>
      webApp
      .post('/tinhte/fcm-push')
      .auth(adminUsername, adminPassword)
      .send(
        {
          client_id: [oauthClientId],
          user_id: [1, 2, 3],
          payload: { notification: { title: 'xxx' } }
        }
      )
      .end((err, res) => {        
        expect(err).to.be.null
        res.should.have.status(202)
        // done()
        setTimeout(verifyPushQueueStats, 100)
      })

      let queuedBefore = 0
      let processedBefore = 0
      const verifyPushQueueStats = function () {
        pushQueueTinhte.stats().then(stats => {
          stats.pushQueueTinhte.queued.should.equal(queuedBefore + 1)
          stats.pushQueueTinhte.processed.should.equal(processedBefore + 1)
          done()
        })
      }
      
      pushQueueTinhte.stats().then(statsBefore => {
        queuedBefore = statsBefore.pushQueueTinhte.queued
        processedBefore = statsBefore.pushQueueTinhte.processed
        setup()
      })
  })

  it('should works with fcm multiple oauthClientId and multiple user_id ', done => {
    nock('https://xfrocks.com').post('/api/index.php?subscriptions').reply(202)
    
    const deviceId = 'firebase-di'
    const deviceId2 = 'firebase-di-2'
    const projectId = 'firebase-pi'

    const setup = () =>
      webApp
        .post('/admin/projects/fcm')
        .auth(adminUsername, adminPassword)
        .send({
          project_id: projectId,
          client_email: 'user@domain.com',
          private_key: '-----BEGIN RSA PRIVATE KEY-----\nMGUCAQACEQDZ9yHDjBHwQKkk+I3pfVeVAgMBAAECEQCw9uXR1zJlRQoGH0SKmPiB\nAgkA+w3y/vic1aECCQDeQlECbNmVdQIJAJPvYlLweKpBAgkAqBpAazUo3IECCQDj\nX4gCHu8E+w==\n-----END RSA PRIVATE KEY-----'
        })
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
          hub_topic: hubTopicUser1,
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
          subscribe2()
        })   
    const subscribe2 = () =>
      webApp
        .post('/subscribe')
        .send({
            hub_uri: hubUri,
            hub_topic: hubTopicUser2,
            oauth_client_id: oauthClientId2,
            oauth_token: oauthToken2,
            extra_data: {
              project: projectId
            },
            device_type: 'firebase',
            device_id: deviceId2
          })
          .end((err, res) => {
            expect(err).to.be.null
            res.should.have.status(202)
            res.text.should.equal('succeeded')
            callback()
          })  

    const callback = () =>
      webApp
      .post('/tinhte/fcm-push')
      .auth(adminUsername, adminPassword)
      .send(
        {
          client_id: [oauthClientId, oauthClientId2],
          user_id: [1, 2, 3],
          payload: { notification: { title: 'xxx' } }
        }
      )
      .end((err, res) => {        
        expect(err).to.be.null
        res.should.have.status(202)
        // done()
        setTimeout(verifyPushQueueStats, 100)
      })

      let queuedBefore = 0
      let processedBefore = 0
      const verifyPushQueueStats = function () {
        pushQueueTinhte.stats().then(stats => {
          stats.pushQueueTinhte.queued.should.equal(queuedBefore + 2)
          stats.pushQueueTinhte.processed.should.equal(processedBefore + 2)
          done()
        })
      }
      
      pushQueueTinhte.stats().then(statsBefore => {
        queuedBefore = statsBefore.pushQueueTinhte.queued
        processedBefore = statsBefore.pushQueueTinhte.processed
        setup()
      })
  })

  it('should works with fcm multiple oauthClientId and 1 user_id ', done => {
    nock('https://xfrocks.com').post('/api/index.php?subscriptions').reply(202)

    const deviceId = 'firebase-di'
    const deviceId2 = 'firebase-di-2'
    const projectId = 'firebase-pi'

    const setup = () =>
      webApp
        .post('/admin/projects/fcm')
        .auth(adminUsername, adminPassword)
        .send({
          project_id: projectId,
          client_email: 'user@domain.com',
          private_key: '-----BEGIN RSA PRIVATE KEY-----\nMGUCAQACEQDZ9yHDjBHwQKkk+I3pfVeVAgMBAAECEQCw9uXR1zJlRQoGH0SKmPiB\nAgkA+w3y/vic1aECCQDeQlECbNmVdQIJAJPvYlLweKpBAgkAqBpAazUo3IECCQDj\nX4gCHu8E+w==\n-----END RSA PRIVATE KEY-----'
        })
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
          hub_topic: hubTopicUser1,
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
          
          subscribe2()
        })   
    const subscribe2 = () =>
      webApp
        .post('/subscribe')
        .send({
            hub_uri: hubUri,
            hub_topic: hubTopicUser2,
            oauth_client_id: oauthClientId2,
            oauth_token: oauthToken2,
            extra_data: {
              project: projectId
            },
            device_type: 'firebase',
            device_id: deviceId2
          })
          .end((err, res) => {
            expect(err).to.be.null
            res.should.have.status(202)
            res.text.should.equal('succeeded')
            callback()
          })  

    const callback = () =>
      webApp
      .post('/tinhte/fcm-push')
      .auth(adminUsername, adminPassword)
      .send(
        {
          client_id: [oauthClientId, oauthClientId2],
          user_id: [1],
          payload: { notification: { title: 'xxx' } }
        }
      )
      .end((err, res) => {        
        expect(err).to.be.null
        res.should.have.status(202)
        // done()
        setTimeout(verifyPushQueueStats, 100)
      })

      let queuedBefore = 0
      let processedBefore = 0
      const verifyPushQueueStats = function () {
        pushQueueTinhte.stats().then(stats => {
          stats.pushQueueTinhte.queued.should.equal(queuedBefore + 1)
          stats.pushQueueTinhte.processed.should.equal(processedBefore + 1)
          done()
        })
      }
      
      pushQueueTinhte.stats().then(statsBefore => {
        queuedBefore = statsBefore.pushQueueTinhte.queued
        processedBefore = statsBefore.pushQueueTinhte.processed
        setup()
      })
  })

  it('should push notification', done => {   
    pusherFcm.setup(config, fcm)
    
    const projectId = 'firebase-pi'
    const payloadWithNotification = { notification: { body: 'body' } }
    pusherFcm.send(
      projectId,
      projectConfig,
      registrationToken,
      payloadWithNotification,
      (err, result) => {
        expect(err).to.be.undefined
        result.sent.should.equal(1)
        const push = fcm._getLatestPush()
        push.payload.should.deep.equal(payloadWithNotification)
        push.options.should.deep.equal({})
        done()
      })
  })

  it('client id missing key', done => {
    const callFcmPush = () =>
      webApp
      .post('/tinhte/fcm-push')
      .auth(adminUsername, adminPassword)
      .send(
        {
          user_id: ['user_id1', 'user_id2', 'user_id3'],
          payload: { notification: { title: 'xxx' } }
        }
      )
      .end((err, res) => {        
        res.should.have.status(400)
        done()
      })

      callFcmPush();
  })

  it('payload missing key', done => {
    const callFcmPush = () =>
      webApp
      .post('/tinhte/fcm-push')
      .auth(adminUsername, adminPassword)
      .send(
        {
          client_id: ['oauthClientId', 'oauthClientId2'],
          user_id: ['user_id1', 'user_id2', 'user_id3'],
        }
      )
      .end((err, res) => {        
        res.should.have.status(400)
        done()
      })

      callFcmPush();
  })

  it('user_id missing key', done => {
    const callFcmPush = () =>
      webApp
      .post('/tinhte/fcm-push')
      .auth(adminUsername, adminPassword)
      .send(
        {
          client_id: ['oauthClientId', 'oauthClientId2'],
          payload: { notification: { title: 'xxx' } }
        }
      )
      .end((err, res) => {        
        res.should.have.status(400)
        done()
      })

      callFcmPush();
  })

  it('send data does not JSON type', done => {
    const callFcmPush = () =>
      webApp
      .post('/tinhte/fcm-push')
      .auth(adminUsername, adminPassword)
      .send(
          "client_id: ['oauthClientId', 'oauthClientId2'], payload: { notification: { title: 'xxx' } }, user_id: ['user_id1', 'user_id2', 'user_id3']"
      )
      .end((err, res) => {        
        res.should.have.status(400)
        done()
      })

      callFcmPush();
  })

  it('send client_id is empty array', done => {
    const callFcmPush = () =>
      webApp
      .post('/tinhte/fcm-push')
      .auth(adminUsername, adminPassword)
      .send(
        {
          client_id: [],
          user_id: ['user_id1', 'user_id2', 'user_id3'],
          payload: { notification: { title: 'xxx' } }
        }
      )
      .end((err, res) => {     
        expect(err).to.be.null
        res.should.have.status(202)
        done()
      })

      callFcmPush();
  })

  it('send user_id is empty array', done => {
    const callFcmPush = () =>
      webApp
      .post('/tinhte/fcm-push')
      .auth(adminUsername, adminPassword)
      .send(
        {
          client_id: ['oauthClientId', 'oauthClientId2'],
          user_id: [],
          payload: { notification: { title: 'xxx' } }
        }
      )
      .end((err, res) => {     
        expect(err).to.be.null
        res.should.have.status(202)
        done()
      })

      callFcmPush();
  })

  it('send payload is empty', done => {
    const callFcmPush = () =>
      webApp
      .post('/tinhte/fcm-push')
      .auth(adminUsername, adminPassword)
      .send(
        {
          client_id: ['oauthClientId', 'oauthClientId2'],
          user_id: ['user_id1', 'user_id2', 'user_id3'],
          payload: {}
        }
      )
      .end((err, res) => {     
        expect(err).to.be.null
        res.should.have.status(202)
        done()
      })

      callFcmPush();
  })


})
