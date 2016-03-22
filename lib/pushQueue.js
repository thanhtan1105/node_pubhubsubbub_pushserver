'use strict';

var pushQueue = exports;
var config = require('./config');
var helper = require('./helper');
var debug = require('debug')('pushserver:pushQueue');
var kue = require('kue');
var _ = require('lodash');
var string = require('string');

pushQueue.enqueue = function (deviceType, deviceId, payload, extraData) {
    var job = pushKue.create(config.pushQueue.queueId, {
        title: deviceType + ' ' + deviceId,
        device_type: deviceType,
        device_id: deviceId,
        payload: payload,
        extra_data: extraData
    });

    job.attempts(config.pushQueue.attempts);
    job.backoff({type: 'exponential'});
    job.ttl(config.pushQueue.ttlInMs);
    job.removeOnComplete(true);

    job.save(function (err) {
        if (!err) {
            debug('Queued', deviceType, deviceId);
        } else {
            debug('Error enqueuing', deviceType, deviceId, err);
        }
    });
};

pushQueue._onJob = function (job, done) {
    var callback = function (err, result) {
        if (!err) {
            debug('pushed', job.data.device_type, job.data.device_id);
            done(null, result);
        } else {
            debug('could not push', job.data.device_type, job.data.device_id, err);
            if (err instanceof Error) {
                done(err);
            } else {
                done(new Error(err));
            }
        }
    };

    switch (job.data.device_type) {
        case 'android':
            return pushQueue._onAndroidJob(job, callback);
        case 'ios':
            return pushQueue._oniOSJob(job, callback);
        case 'windows':
            return pushQueue._onWindowsJob(job, callback);
    }

    return callback('Unrecognized device type ' + data.device_type);
};

pushQueue._onAndroidJob = function (job, callback) {
    if (!pusher) {
        return callback('pusher has not been setup properly');
    }

    var data = job.data;
    var gcmPayload = {
        action: data.action
    };
    if (data.payload.notification_id > 0) {
        gcmPayload['notification_id'] = data.payload.notification_id;
        gcmPayload['notification'] = helper.stripHtml(data.payload.notification_html);
    } else {
        data.payload.forEach(function (dataPayload, i) {
            switch (i) {
                case 'notification_id':
                case 'notification_html':
                    // ignore
                    break;
                default:
                    gcmPayload[i] = dataPayload;
            }
        });
    }

    var packageId = '';
    var gcmKey = '';
    if (data.extra_data && typeof data.extra_data.package == 'string') {
        packageId = data.extra_data.package;
        gcmKey = config.gcm.keys[packageId];
    } else {
        gcmKey = config.gcm.keys[config.gcm.defaultKeyId];
    }

    if (gcmKey) {
        pusher.gcm(gcmKey, data.device_id, gcmPayload, callback);
    } else {
        if (!packageId) {
            return callback('extra_data.package is missing');
        }

        if (!projectDb) {
            return callback('projectDb has not been setup properly');
        }

        projectDb.findConfig('gcm', packageId, function (projectConfig) {
            if (!projectConfig || !projectConfig.api_key) {
                return callback('Project could not be found', packageId);
            }

            pusher.gcm(projectConfig.api_key, data.device_id, gcmPayload, callback);
        });
    }
};

pushQueue._oniOSJob = function (job, callback) {
    var data = job.data;
    var message = helper.stripHtml(data.payload.notification_html);
    var apnMessage = helper.prepareApnMessage(message);
    if (apnMessage) {
        job.log('apnMessage = %s', apnMessage);

        if (pusher) {
            pusher.apn(data.device_id, {
                aps: {
                    alert: apnMessage
                }
            }, callback);
        } else {
            callback('pusher has not been setup properly');
        }
    } else {
        callback('No APN message');
    }
};

pushQueue._onWindowsJob = function (job, callback) {
    if (!pusher) {
        return callback('pusher has not been setup properly');
    }

    var data = job.data;
    var payload = data.payload;
    var packageId = '';
    var clientId = config.wns.client_id;
    var clientSecret = config.wns.client_secret;
    var channelUri = '';

    payload.extra_data = {};
    _.forEach(data.extra_data, function (value, key) {
        switch (key) {
            case 'channel_uri':
                channelUri = value;
                break;
            case 'package':
                packageId = value;
                clientId = '';
                clientSecret = '';
                break;
            default:
                payload.extra_data[key] = value;
        }
    });

    if (!channelUri) {
        return callback('channel_uri is missing');
    }
    var payloadJson = JSON.stringify(payload);

    if (clientId && clientSecret) {
        pusher.wns(clientId, clientSecret, channelUri, payloadJson, callback);
    } else {
        if (!packageId) {
            return callback('extra_data.package is missing');
        }

        if (!projectDb) {
            return callback('projectDb has not been setup properly');
        }

        projectDb.findConfig('wns', packageId, function (projectConfig) {
            if (!projectConfig.client_id || !projectConfig.client_secret) {
                return callback('Project could not be found', packageId);
            }

            pusher.wns(projectConfig.client_id, projectConfig.client_secret, channelUri, payloadJson, callback);
        });
    }

};

pushQueue.expressMiddleware = function () {
    return kue.app;
};

var pusher = null;
pushQueue.setPusher = function (_pusher) {
    pusher = _pusher;
};

var projectDb = null;
pushQueue.setProjectDb = function (_projectDb) {
    projectDb = _projectDb;
};

var pushKue = kue.createQueue({
    disableSearch: true,
    jobEvents: false,
    redis: config.redis
});
pushKue.watchStuckJobs(1000);
pushKue.process(config.pushQueue.queueId, 1, pushQueue._onJob);