var web = exports;
var config = require('./config');
var deviceDb = require('./db').devices;
var pushQueue = require('./pushQueue');
var debug = require('debug')('web');
var express = require('express');
var request = require('request');
var url = require('url');

var app = express();

app.use(express.compress());
app.use(express.bodyParser());

var getCallbackUri = function(req) {
    return req.protocol + '://' + req.get('host') + '/callback';
}

var prepareSubscribeData = function(req, res) {
    var hubUri = req.body.hub_uri;
    if (!hubUri) {
        hubUri = '';
    }

    var hubTopic = req.body.hub_topic;
    if (!hubTopic && hubUri) {
        // try to get hub topic from hub uri
        var hubUriParsed = url.parse(hubUri, true);
        if (!!hubUriParsed.query || !!hubUriParsed.query['hub.topic']) {
            debug('`hub_topic` is determined from `hub_uri`');
            hubTopic = hubUriParsed.query['hub.topic'];
        }
    }
    if (!hubTopic) {
        hubTopic = '';
    }

    var oauthClientId = req.body.oauth_client_id;
    if (!oauthClientId) {
        oauthClientId = '';
    }

    var oauthToken = req.body.oauth_token;
    if (!oauthToken) {
        oauthToken = '';
    }

    var deviceType = req.body.device_type;
    if (!deviceType) {
        deviceType = '';
    }

    var deviceId = req.body.device_id;
    if (!deviceId) {
        deviceId = '';
    }

    var extraData = req.body.extra_data;
    if (!extraData) {
        extraData = null;
    }

    var data = {
        'callback': getCallbackUri(req),

        'hub_uri': hubUri,
        'hub_topic': hubTopic,
        'oauth_client_id': oauthClientId,
        'oauth_token': oauthToken,

        'device_type': deviceType,
        'device_id': deviceId,
        'extra_data': extraData,
    };

    return data;
};

app.post('/subscribe', function (req, res) {
    var data = prepareSubscribeData(req, res);
    if (!data.hub_uri) {
        debug('/subscribe', '`hub_uri` is missing');
        return res.status(400).send();
    }

    if (!data.oauth_client_id || !data.oauth_token) {
        debug('/subscribe', 'OAuth information is missing');
        return res.status(401).send();
    }

    if (!data.device_type || !data.device_id) {
        debug('/subscribe', 'Device data is missing');
        return res.status(403).send();
    }

    var formData = {
        'hub.callback': data.callback,
        'hub.mode': 'subscribe',
        'hub.topic': data.hub_topic,

        'oauth_token': data.oauth_token,
        'client_id': data.oauth_client_id,
    };

    // save the device first, so when server verifies intent, we can look it up
    deviceDb.save(data.device_type, data.device_id, data.oauth_client_id, data.hub_topic, data.extra_data);

    request.post({
        'url': data.hub_uri,
        'form': formData
    }, function(err, httpResponse, body) {
        if (httpResponse) {
            var success = false;
            if (httpResponse.statusCode >= 200 && httpResponse.statusCode < 300) {
                success = true;
            }

            debug('/subscribe', success ? 'succeeded' : 'failed', data.hub_uri, formData);
            return res.status(httpResponse.statusCode).send(body);
        } else {
            debug('/subscribe', err, data.hub_uri, formData);
            return res.status(500).send();
        }
    });
});

app.post('/unsubscribe', function (req, res) {
    var data = prepareSubscribeData(req, res);

    if (!data.hub_uri || !data.hub_topic) {
        debug('/unsubscribe', 'Hub information is missing');
        return res.status(400).send();
    }

    if (!data.oauth_client_id) {
        debug('/unsubscribe', '`oauth_client_id` is missing');
        return res.status(401).send();
    }

    if (!data.device_type || !data.device_id) {
        debug('/unsubscribe', 'Device data is missing');
        return res.status(403).send();
    }

    deviceDb.findDevices(data.oauth_client_id, data.hub_topic, function(devices) {
        var deviceFound = false;

        for (var i in devices) {
            if (data.device_id == devices[i].device_id) {
                deviceFound = devices[i];
            }
        }

        if (deviceFound) {
            deviceDb.save(deviceFound.device_type, deviceFound.device_id, deviceFound.oauth_client_id, '', deviceFound.extra_data);

            var formData = {
                'hub.callback': data.callback,
                'hub.mode': 'unsubscribe',
                'hub.topic': data.hub_topic,

                'oauth_token': data.oauth_token,
                'client_id': data.oauth_client_id,
            };

            request.post({
                'url': data.hub_uri,
                'form': formData
            }, function(err, httpResponse, body) {
                if (httpResponse) {
                    var success = false;
                    if (httpResponse.statusCode >= 200 && httpResponse.statusCode < 300) {
                        success = true;
                    }

                    debug('/unsubscribe', success ? 'succeeded' : 'failed', data.hub_uri, formData);
                    return res.status(httpResponse.statusCode).send(body);
                } else {
                    debug('/unsubscribe', err, data.hub_uri, formData);
                    return res.status(500).send();
                }
            });
        } else {
            debug('/unsubscribe could not find registered device');
            res.status(404).send();
        }
    });
});

app.post('/unregister', function(req, res) {
    var data = prepareSubscribeData(req, res);

    if (!data.oauth_client_id) {
        debug('/unregister', '`oauth_client_id` is missing');
        return res.status(401).send();
    }

    if (!data.device_type || !data.device_id) {
        debug('/unregister', 'Device data is missing');
        return res.status(403).send();
    }

    // no verification needed because knowing device_id is quite hard already
    // also no need to confirm with hub server, future callbacks should be dropped automatically
    deviceDb.delete(data.device_type, data.device_id, data.oauth_client_id);

    return res.status(200).send();
});

app.get('/callback', function (req, res) {
    var parsed = url.parse(req.url, true);

    if (!parsed.query) {
        debug('/callback', '`hub.*` is missing');
        return res.status(400).send();
    }

    if (!parsed.query['client_id']) {
        debug('/callback', '`client_id` is missing');
        return res.status(401).send();
    }

    if (!parsed.query['hub.challenge']) {
        debug('/callback', '`hub.challenge` is missing');
        return res.status(403).send();
    }

    if (!parsed.query['hub.mode']) {
        debug('/callback', '`hub.mode` is missing');
        return res.status(404).send();
    }

    var hubTopic = parsed.query['hub.topic'];
    if (!hubTopic) {
        hubTopic = '';
    }

    deviceDb.findDevices(parsed.query['client_id'], hubTopic, function(devices) {
        var isSubscribe = (parsed.query['hub.mode'] === 'subscribe');
        var devicesFound = devices.length > 0;

        if (isSubscribe != devicesFound) {
            return res.status(405).send();
        }

        debug('/callback', parsed.query);

        return res.send(parsed.query['hub.challenge']);
    });
});

app.post('/callback', function (req, res) {
    if (typeof req.body == 'object') {
        for (var i in req.body) {
            var ping = req.body[i];

            if (typeof ping != 'object') {
                debug('/callback', 'ping is not an object', ping);
                continue;
            } 

            if (!ping.client_id) {
                debug('/callback', 'ping does not has client information', ping);
                continue;
            }

            deviceDb.findDevices(ping.client_id, ping.topic, function(devices) {
                for (var i in devices) {
                    pushQueue.enqueue(devices[i].device_type, devices[i].device_id, ping.object_data, devices[i].extra_data);
                }
            });
        }
    }

    return res.send();
});

app.get('*', function(req, res) {
    res.send('Hi, I am ' + getCallbackUri(req));
});

web.start = function () {
    var port = config.web.port;
    app.listen(port);
    debug('Listening on port ' + port + '...');
};
