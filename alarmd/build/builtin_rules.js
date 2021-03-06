var __extends = this.__extends || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
};
///<reference path="externals.d.ts"/>
var util = require('util');
var _ = require('lodash');
var U = require('./u');
var ruleEngineModule = require('./rule_engine');
var serviceModule = require('./service');
var itemModule = require('./item');
var arming = require('./arming');
var push_notification = require('./push_notification');
var logging = require('./logging');
var logger = new logging.Logger(__filename);
//---------------------------------------------------------------------------------------------------------------------
var Arm = (function (_super) {
    __extends(Arm, _super);
    function Arm() {
        _super.apply(this, arguments);
        this.prev = serviceModule.Service.instance.armedStates.active;
    }
    Arm.prototype.run = function () {
        this.prev = serviceModule.Service.instance.armedStates.active;
        this.armedDetected = _.filter(this.prev.allItems, function (item) { return item instanceof itemModule.Sensor && item.isDetected(); });
    };
    return Arm;
})(ruleEngineModule.Rule);
ruleEngineModule.defineRule({ ruleClass: Arm.prototype, depends: ['ArmedStates'] });
//---------------------------------------------------------------------------------------------------------------------
var ArmHistory = (function (_super) {
    __extends(ArmHistory, _super);
    function ArmHistory() {
        _super.apply(this, arguments);
        this.armedState = serviceModule.Service.instance.armedStates.active;
        this.prevDetected = {};
        this.arm = this.getRule(Arm.prototype);
    }
    ArmHistory.prototype.shouldRun = function () {
        return _super.prototype.shouldRun.call(this) && serviceModule.Service.instance.armedStates.active.timeLeft == 0;
    };
    ArmHistory.prototype.run = function () {
        var _this = this;
        var now = new Date();
        if (serviceModule.Service.instance.armedStates.active != this.armedState) {
            this.armedState = serviceModule.Service.instance.armedStates.active;
            this.prevDetected = {};
        }
        var updateEvent = false;
        _.forEach(this.arm.armedDetected, function (item) {
            if (_this.armedState.bypassedItems[item.id])
                return;
            if (!_this.armedState.triggeredItems[item.id]) {
                updateEvent = true;
                _this.armedState.triggeredItems[item.id] = new arming.TriggeredItem(item);
                _this.armedState.notifyChanged();
            }
            else if (!_this.prevDetected[item.id]) {
                var t = _this.armedState.triggeredItems[item.id];
                if ((now.valueOf() - t.lastTriggered.valueOf()) / 1000 > 10)
                    updateEvent = true;
                t.lastTriggered = now;
                ++t.count;
                _this.armedState.notifyChanged();
            }
        }, this);
        if (updateEvent)
            this.armedState.updateLogEvent();
        this.prevDetected = {};
        _.forEach(this.arm.armedDetected, function (e) {
            _this.prevDetected[e.id] = true;
        }, this);
    };
    return ArmHistory;
})(ruleEngineModule.Rule);
ruleEngineModule.defineRule({ ruleClass: ArmHistory.prototype, depends: ['ArmedStates', 'Arm'] });
//---------------------------------------------------------------------------------------------------------------------
var WouldTrigger = (function (_super) {
    __extends(WouldTrigger, _super);
    function WouldTrigger() {
        _super.apply(this, arguments);
        this.armedState = serviceModule.Service.instance.armedStates.active;
        this.notified = {};
        this.arm = this.getRule(Arm.prototype);
    }
    WouldTrigger.prototype.shouldRun = function () {
        return _super.prototype.shouldRun.call(this) && (serviceModule.Service.instance.armedStates.active.timeLeft > 0 || serviceModule.Service.instance.armedStates.active != this.armedState) || Object.keys(serviceModule.Service.instance.armedStates.active.wouldTriggerItems).length > 0;
    };
    WouldTrigger.prototype.run = function () {
        var _this = this;
        if (serviceModule.Service.instance.armedStates.active != this.armedState) {
            this.armedState = serviceModule.Service.instance.armedStates.active;
            this.notified = {};
        }
        if (this.armedState.timeLeft == 0) {
            this.armedState.wouldTriggerItems = {};
            this.armedState.updateLogEvent();
        }
        var wouldTrigger = [];
        var updateEvent = false;
        _.forEach(this.arm.armedDetected, function (item) {
            if (_this.armedState.bypassedItems[item.id])
                return;
            if (serviceModule.Service.instance.items.delayedArmed.at(item.id))
                return;
            if (!_this.notified[item.id]) {
                _this.notified[item.id] = true;
                wouldTrigger.push(item);
            }
            if (wouldTrigger.length == 0)
                return false;
            var now = new Date();
            _.forEach(wouldTrigger, function (wtItem) {
                var wouldTriggerItem = _this.armedState.wouldTriggerItems[wtItem.id];
                if (!wouldTriggerItem) {
                    wouldTriggerItem = new arming.WouldTriggerItem(wtItem);
                    _this.armedState.wouldTriggerItems[wtItem.id] = wouldTriggerItem;
                }
                wouldTriggerItem.lastTriggered = now;
                ++wouldTriggerItem.count;
                updateEvent = true;
            }, _this);
            if (updateEvent)
                _this.armedState.updateLogEvent();
        }, this);
    };
    return WouldTrigger;
})(ruleEngineModule.Rule);
ruleEngineModule.defineRule({ ruleClass: WouldTrigger.prototype, depends: ['ArmedStates', 'Arm'] });
//---------------------------------------------------------------------------------------------------------------------
var NotifyMonitor = (function (_super) {
    __extends(NotifyMonitor, _super);
    function NotifyMonitor() {
        _super.apply(this, arguments);
        this.prevDetectedString = '';
    }
    NotifyMonitor.prototype.shouldRun = function () {
        return _super.prototype.shouldRun.call(this) && !U.isNullOrUndefined(serviceModule.Service.instance.pushNotification);
    };
    NotifyMonitor.prototype.run = function () {
        var detected = _.filter(serviceModule.Service.instance.items.monitor.allItems, function (item) { return item instanceof itemModule.Sensor && item.isDetected(); });
        if (detected.length == 0)
            return;
        var detectedString = detected.map(function (item) { return item.id; }).join(',');
        if (detectedString != this.prevDetectedString) {
            this.prevDetectedString = detectedString;
            serviceModule.Service.instance.pushNotification.send(new push_notification.Message({
                title: "Monitor Sensors Detected",
                body: detectedString,
                priority: 1 /* HIGH */
            }));
        }
    };
    return NotifyMonitor;
})(ruleEngineModule.Rule);
ruleEngineModule.defineRule({ ruleClass: NotifyMonitor.prototype, depends: ['monitor'] });
//---------------------------------------------------------------------------------------------------------------------
var ActivateSiren = (function (_super) {
    __extends(ActivateSiren, _super);
    function ActivateSiren() {
        _super.apply(this, arguments);
        this.armedState = serviceModule.Service.instance.armedStates.active;
        this.notified = {};
        this.arm = this.getRule(Arm.prototype);
        this.prevTimeLeftToNextState = 0;
    }
    ActivateSiren.prototype.activateSiren = function () {
        serviceModule.Service.instance.siren.activate();
        this.armedState.lastSiren = new Date();
        this.armedState.notifyChanged();
    };
    ActivateSiren.prototype.checkDispatchNotification = function () {
        var _this = this;
        if (!serviceModule.Service.instance.siren.isActive())
            return;
        var toNotify = {};
        _.forEach(this.armedState.triggeredItems, function (v, k) {
            if (_this.notified[k])
                return;
            _this.notified[k] = true;
            toNotify[k] = true;
        }, this);
        _.forEach(this.arm.armedDetected, function (item) {
            if (_this.armedState.bypassedItems[item.id])
                return;
            if (_this.notified[item.id])
                return;
            _this.notified[item.id] = true;
            toNotify[item.id] = true;
        }, this);
        if (Object.keys(toNotify).length > 0 && serviceModule.Service.instance.pushNotification != null) {
            //TODO change priority to CRITICAL (after debugging)
            serviceModule.Service.instance.pushNotification.send(new push_notification.Message({
                title: "Siren !!!",
                body: util.format("Sensors: %s", Object.keys(toNotify).join('\n')),
                priority: 1 /* HIGH */
            }));
        }
    };
    ActivateSiren.prototype.run = function () {
        var _this = this;
        if (serviceModule.Service.instance.armedStates.active != this.armedState) {
            this.armedState = serviceModule.Service.instance.armedStates.active;
            this.notified = {};
            this.prevTimeLeftToNextState = 0;
            serviceModule.Service.instance.siren.deactivate();
        }
        if (serviceModule.Service.instance.siren.timeLeftToNextState > 0)
            this.prevTimeLeftToNextState = serviceModule.Service.instance.siren.timeLeftToNextState;
        else if (this.prevTimeLeftToNextState > 0) {
            this.prevTimeLeftToNextState = 0;
            if (serviceModule.Service.instance.siren.isActive())
                serviceModule.Service.instance.siren.deactivate();
            else
                this.activateSiren();
            return;
        }
        this.checkDispatchNotification();
        if (serviceModule.Service.instance.siren.isActive())
            return;
        var delayedSensors = {};
        var nonDelayedSensors = {};
        if (this.armedState.timeLeft == 0) {
            var activate = false;
            var delayed = false;
            _.forEach(this.arm.armedDetected, function (item) {
                if (!_this.armedState.bypassedItems[item.id]) {
                    if (serviceModule.Service.instance.items.delayedSiren.containsItem(item))
                        delayedSensors[item.id] = true;
                    else
                        nonDelayedSensors[item.id] = true;
                }
            }, this);
            if (Object.keys(nonDelayedSensors).length > 0 || Object.keys(delayedSensors).length > 0 && this.armedState.sirenDelay == 0) {
                logger.info("Activating Siren now. sensors: %s", _.union(Object.keys(nonDelayedSensors), Object.keys(delayedSensors)).join('\n'));
                this.activateSiren();
            }
            else if (Object.keys(delayedSensors).length > 0 && serviceModule.Service.instance.siren.timeLeftToNextState == 0) {
                logger.info("Activating Siren in %s, sensors: %s", this.armedState.sirenDelay, Object.keys(delayedSensors).join('\n'));
                serviceModule.Service.instance.siren.scheduleActivate(this.armedState.sirenDelay);
            }
        }
    };
    return ActivateSiren;
})(ruleEngineModule.Rule);
ruleEngineModule.defineRule({ ruleClass: ActivateSiren.prototype, depends: ['ArmedStates', 'Arm'] });
//---------------------------------------------------------------------------------------------------------------------
var SensorHistory = (function (_super) {
    __extends(SensorHistory, _super);
    function SensorHistory() {
        _super.apply(this, arguments);
        this.prevDetected = {};
    }
    SensorHistory.prototype.run = function () {
        var _this = this;
        var now = new Date();
        var slot = Math.floor(now.getTime() / 1000 / 300) * 300;
        var detected = _.filter(serviceModule.Service.instance.items.all.allItems, function (item) { return item instanceof itemModule.Sensor && item.isDetected(); });
        var oldPrevDetected = this.prevDetected;
        this.prevDetected = {};
        _.forEach(detected, function (item) {
            if (!oldPrevDetected[item.id]) {
                _this.prevDetected[item.id] = true;
                serviceModule.Service.instance.sensorHistory.add(slot, item.id);
            }
        }, this);
    };
    return SensorHistory;
})(ruleEngineModule.Rule);
ruleEngineModule.defineRule({ ruleClass: SensorHistory.prototype, depends: ['ArmedStates'] });
//# sourceMappingURL=builtin_rules.js.map