var db = require('../lib/db');
var chai = require('chai');

chai.should();
var expect = chai.expect;

describe('db/Project', function () {

    db.projects._model.collection.drop();

    afterEach(function (done) {
        db.projects._model.collection.drop();
        done();
    });

    it('should save project', function (done) {
        var projectType = 'pt';
        var projectId = 'pi';
        var configuration = {foo: 'bar'};

        var step1 = function () {
            db.projects.save(projectType, projectId, configuration, function (isSaved) {
                isSaved.should.not.be.false;
                step2();
            });
        };

        var step2 = function () {
            db.projects._model.find({
                project_type: projectType,
                project_id: projectId
            }, function (err, projects) {
                projects.should.be.a('array');
                projects.length.should.equal(1);

                var project = projects[0];
                project.configuration.should.be.a('object');
                project.configuration.foo.should.equal(configuration.foo);

                done();
            });
        };

        step1();
    });

    it('should save gcm', function (done) {
        var packageId = 'pi';
        var apiKey = 'ak';

        var step1 = function () {
            db.projects.saveGcm(packageId, apiKey, function (isSaved) {
                isSaved.should.not.be.false;
                step2();
            });
        };

        var step2 = function () {
            db.projects._model.find({
                project_type: 'gcm',
                project_id: packageId
            }, function (err, projects) {
                projects.should.be.a('array');
                projects.length.should.equal(1);

                var project = projects[0];
                project.configuration.should.be.a('object');
                project.configuration.api_key.should.equal(apiKey);

                done();
            });
        };

        step1();
    });

    it('should save wns', function (done) {
        var packageId = 'pi';
        var clientId = 'ci';
        var clientSecret = 'cs';

        var step1 = function () {
            db.projects.saveWns(packageId, clientId, clientSecret, function (isSaved) {
                isSaved.should.not.be.false;
                step2();
            });
        };

        var step2 = function () {
            db.projects._model.find({
                project_type: 'wns',
                project_id: packageId
            }, function (err, projects) {
                projects.should.be.a('array');
                projects.length.should.equal(1);

                var project = projects[0];
                project.configuration.should.be.a('object');
                project.configuration.client_id.should.equal(clientId);
                project.configuration.client_secret.should.equal(clientSecret);

                done();
            });
        };

        step1();
    });

    it('should update project', function (done) {
        var projectType = 'dt';
        var projectId = 'di';
        var configuration = {foo: 'bar'};
        var configuration2 = {bar: 'foo'};
        var theProject = null;

        var init = function () {
            db.projects._model.create({
                project_type: projectType,
                project_id: projectId,
                configuration: configuration
            }, function (err, project) {
                theProject = project;
                step1();
            });
        };

        var step1 = function () {
            db.projects.save(projectType, projectId, configuration2, function (isSaved) {
                isSaved.should.not.be.false;
                step2();
            });
        };

        var step2 = function () {
            db.projects._model.findById(theProject._id, function (err, project) {
                project.configuration.should.has.all.keys('foo', 'bar');
                project.configuration.foo.should.equal(configuration.foo);
                project.configuration.bar.should.equal(configuration2.bar);

                done();
            });
        };

        init();
    });

    it('should return project', function (done) {
        var projectType = 'dt';
        var projectId = 'di';
        var configuration = {foo: 'bar'};

        var init = function () {
            db.projects._model.create({
                project_type: projectType,
                project_id: projectId,
                configuration: configuration
            }, function () {
                step1();
            });
        };

        var step1 = function () {
            db.projects.findConfig(projectType, projectId, function (projectConfig) {
                projectConfig.should.be.a('object');
                projectConfig.foo.should.equal(configuration.foo);

                done();
            });
        };

        init();
    });
});