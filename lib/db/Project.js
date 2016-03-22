'use strict';

var debug = require('debug')('pushserver:db:Project');
var _ = require('lodash');

var Project = exports = module.exports = function (mongoose) {
    var projectSchema = new mongoose.Schema({
        project_type: {type: String, required: true},
        project_id: {type: String, required: true},
        configuration: {type: Object, required: true}
    });
    projectSchema.index({project_type: 1, project_id: 1});
    var projectModel = mongoose.model('projects', projectSchema);

    return {
        _model: projectModel,

        saveGcm: function (packageId, apiKey, callback) {
            return this.save('gcm', packageId, {api_key: apiKey}, callback);
        },

        saveWns: function (packageId, clientId, clientSecret, callback) {
            return this.save('wns', packageId, {
                client_id: clientId,
                client_secret: clientSecret
            }, callback);
        },

        save: function (projectType, projectId, configuration, callback) {
            var tryUpdating = function () {
                projectModel.findOne({
                    project_type: projectType,
                    project_id: projectId
                }, function (err, project) {
                    if (!err && project) {
                        project.configuration = _.assign({}, project.configuration, configuration);
                        project.save(function (err, updatedProject) {
                            if (!err && updatedProject) {
                                updateDone(updatedProject);
                            } else {
                                updateFailed(err);
                            }
                        });
                    } else {
                        updateFailed(err);
                    }
                });
            };

            var tryInserting = function () {
                var project = new projectModel({
                    project_type: projectType,
                    project_id: projectId,
                    configuration: configuration
                });

                project.save(function (err, insertedProject) {
                    if (!err) {
                        insertDone(insertedProject);
                    } else {
                        insertFailed(err);
                    }
                });
            };

            var updateDone = function (project) {
                debug('Updated project', projectType, projectId, project._id);
                done('updated');
            };

            var updateFailed = function (err) {
                if (err) {
                    debug('Unable to update project', projectType, projectId, err);
                }
                tryInserting();
            };

            var insertDone = function (project) {
                debug('Saved project', projectType, projectId, project._id);
                done('inserted');
            };

            var insertFailed = function (err) {
                debug('Unable to insert project', projectType, projectId, err);
                done(false);
            };

            var done = function (result) {
                if (typeof callback == 'function') {
                    callback(result);
                }
            };

            tryUpdating();
        },

        findConfig: function (projectType, projectId, callback) {
            var done = function (projectConfig) {
                if (typeof callback == 'function') {
                    callback(projectConfig);
                }
            };

            projectModel.findOne({
                project_type: projectType,
                project_id: projectId
            }, function (err, project) {
                if (!err && project) {
                    done(project.configuration);
                } else {
                    debug('Error finding project', projectType, projectId, err);
                    done(null);
                }
            });
        }
    };
};