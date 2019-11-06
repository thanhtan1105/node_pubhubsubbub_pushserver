'use strict'

const pushQueueTinhte = exports
const config = require('../config')
const helper = require('../helper')
const debug = require('debug')('pushserver:pushQueueTinhte')
const _ = require('lodash')

const queueId = 'tinhteFcmPush'

pushQueueTinhte.MESSAGES = {
  QUEUE_ERROR: 'Error queuing',
  PUSH_SUCCESS: 'Pushed',
  PUSH_ERROR: 'Error pushing',
  JOB_ERROR_UNRECOGNIZED_DEVICE_TYPE: 'Unrecognized device type',
  JOB_ERROR_PUSHER: 'Pusher error',
  JOB_ERROR_PACKAGE_MISSING: 'extra_data.package missing',
  JOB_ERROR_PAYLOAD: 'Invalid payload',
  JOB_ERROR_PROJECT_EXTRA_DATA_MISSING: 'extra_data.project missing',
  JOB_ERROR_PROJECT_NOT_FOUND: 'Project not found',
  JOB_ERROR_PROJECT_CONFIG: 'Bad project config'
}

let pushKue = null
let pusher = null
let db = null
let stats = {
  queued: 0,
  processed: 0
}
pushQueueTinhte.setup = function (_pushKue, _pusher, _db) {
  pushKue = _pushKue
  if (pushKue) {
    pushKue.process(queueId, 1, pushQueueTinhte._onJob)
  }

  pusher = _pusher
  db = _db
  stats.queued = 0
  stats.processed = 0

  return pushQueueTinhte
}

pushQueueTinhte.stats = function () {
  return pusher.stats().then((merged) => {
    merged.pushQueueTinhte = _.cloneDeep(stats)
    return merged
  })
}

pushQueueTinhte.createQueue = function (kue) {
  const prefix = helper.appendNodeEnv(config.pushQueue.prefix)
  const q = kue.createQueue({
    disableSearch: true,
    jobEvents: false,
    prefix: prefix,
    redis: config.redis
  })
  q.watchStuckJobs(1000)

  return q
}

pushQueueTinhte.enqueue = function (deviceType, deviceIds, payload, extraData) {
  if (_.isString(deviceIds)) {
    deviceIds = [deviceIds]
  }

  let jobTitle = deviceType
  if (_.has(extraData, '_ping__client_id') &&
      _.has(extraData, '_ping__topic')
  ) {
    jobTitle = extraData._ping__client_id +
        '/' + extraData._ping__topic +
        ' ' + deviceType
  }
  if (deviceIds.length === 1) {
    jobTitle += '-' + deviceIds[0]
  } else {
    jobTitle += ' x' + deviceIds.length
  }

  let delay = 0
  if (_.has(extraData, '_pushQueueTinhte__attempted')) {
    if (extraData._pushQueueTinhte__attempted >= config.pushQueue.attempts) {
      return false
    }

    const powOf2 = Math.pow(2, extraData._pushQueueTinhte__attempted - 1)
    delay = config.pushQueue.delayInMs * powOf2
  }
  const job = pushKue.create(queueId, {
    title: jobTitle,
    device_type: deviceType,
    device_ids: deviceIds,
    payload: payload,
    extra_data: extraData
  })
  job.delay(delay)
  job.ttl(config.pushQueue.ttlInMs)
  job.removeOnComplete(true)

  job.save(function (err) {
    if (err) {
      return debug(pushQueueTinhte.MESSAGES.QUEUE_ERROR,
        deviceType, deviceIds, err)
    }

    stats.queued++
  })

  return true
}

pushQueueTinhte._onJob = function (job, jobCallback) {
  stats.processed++

  const jobDone = helper.later(jobCallback)
  const done = function (err, pusherResult) {
    if (!err) {
      debug(pushQueueTinhte.MESSAGES.PUSH_SUCCESS, job.data.title)
      return jobDone()
    }

    debug(pushQueueTinhte.MESSAGES.PUSH_ERROR, job.data.title, err, pusherResult)

    const result = {
      retries: [],
      invalids: []
    }
    _.merge(result, _.pick(pusherResult, _.keys(result)))

    if (_.has(result, 'retries') && result.retries.length > 0) {
      const retryExtraData = _.merge({}, job.data.extra_data)
      if (_.has(retryExtraData, '_pushQueueTinhte__attempted')) {
        retryExtraData._pushQueueTinhte__attempted++
      } else {
        retryExtraData._pushQueueTinhte__attempted = 1
      }

      pushQueueTinhte.enqueue(
        job.data.device_type,
        result.retries,
        job.data.payload,
        retryExtraData
      )
    }

    let invalids = []
    if (_.has(result, 'invalids')) {
      invalids = _.clone(result.invalids)
    }

    const deleteInvalid = () => {
      if (invalids.length > 0) {
        const deviceId = invalids.shift()
        return db.devices.delete(job.data.device_type, deviceId,
          null, null, deleteInvalid)
      }

      let jobError = err
      if (!_.isString(jobError) && !_.isError(jobError)) {
        jobError = JSON.stringify(err)
      }
      jobDone(jobError, result)
    }

    deleteInvalid()
  }

  try {
    return pushQueueTinhte._onFirebaseJob(job, done)
  } catch (e) {
    debug(e)
    return done(pushQueueTinhte.MESSAGES.JOB_ERROR_PUSHER)
  }
}

pushQueueTinhte._onFirebaseJob = function (job, callback) {
  const done = helper.later(callback)

  const { data } = job
  const { extra_data: extraData } = data
  if (typeof extraData !== 'object') {
    return done(pushQueueTinhte.MESSAGES.JOB_ERROR_PROJECT_EXTRA_DATA_MISSING,
      { invalids: data.device_ids })
  }
  const {
    badge_with_convo: badgeWithConvo,
    click_action: clickAction,
    notification,
    project: projectId
  } = extraData
  if (typeof projectId !== 'string') {
    return done(pushQueueTinhte.MESSAGES.JOB_ERROR_PROJECT_EXTRA_DATA_MISSING,
      { invalids: data.device_ids })
  }

  const payload = helper.prepareFcmPayload(
    data.payload,
    {
      badgeWithConvo: helper.isPositive(badgeWithConvo),
      clickAction,
      notification: helper.isPositive(notification)
    }
  )
  
  db.projects.findConfig('fcm', projectId, (config) => {
    if (!config) {
      debug('Project not found', projectId)
      return done(pushQueueTinhte.MESSAGES.JOB_ERROR_PROJECT_NOT_FOUND,
        { invalids: data.device_ids })
    }

    return pusher.fcm(projectId, config, data.device_ids, payload, done)
  })
}

pushQueueTinhte._reset = function (callback) {
  debug('Shutting down queue…')
  pushKue.shutdown(0, callback)
}
