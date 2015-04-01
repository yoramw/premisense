///<reference path="externals.d.ts"/>
import util = require('util')
import eventsModule = require('events')
import through = require('through')
import assert = require('assert')
import _ = require('lodash')

import U = require('./u')
import ruleEngineModule = require('./rule_engine')
import serviceModule = require('./service')
import itemModule = require('./item')
import arming = require('./arming')

import logging = require('./logging');
var logger = new logging.Logger(__filename);


//---------------------------------------------------------------------------------------------------------------------
//TODO remove me after debugging
class Dummy extends ruleEngineModule.Rule {
}
//---------------------------------------------------------------------------------------------------------------------
class Arm extends Dummy {
  prev:arming.ArmedState = serviceModule.Service.instance.armedStates.active;
  armedDetected:itemModule.Item[];

  run():void {
    this.prev = serviceModule.Service.instance.armedStates.active;
    this.armedDetected = _.filter(this.prev.allItems, (item) => item instanceof itemModule.Sensor && item.isDetected());
  }
}
ruleEngineModule.defineRule({ruleClass: Arm.prototype, depends: ['ArmedStates']});
//---------------------------------------------------------------------------------------------------------------------
class ArmHistory extends ruleEngineModule.Rule {

  armedState:arming.ArmedState = serviceModule.Service.instance.armedStates.active;
  prevDetected = {};
  arm:Arm = this.getRule(Arm.prototype);

  shouldRun():boolean {
    return super.shouldRun() && serviceModule.Service.instance.armedStates.active.timeLeft == 0;
  }

  run():void {
    var now = new Date();

    if (serviceModule.Service.instance.armedStates.active != this.armedState) {
      this.armedState = serviceModule.Service.instance.armedStates.active;
      this.prevDetected = {};
    }

    var updateEvent:boolean = false;
    _.forEach(this.arm.armedDetected, (item) => {
      if (this.armedState.bypassedItems[item.id])
        return;

      if (!this.armedState.triggeredItems[item.id]) {
        updateEvent = true;

        this.armedState.triggeredItems[item.id] = new arming.TriggeredItem(item);
        this.armedState.notifyChanged();

      } else if (!this.prevDetected[item.id]) {

        var t:arming.TriggeredItem = this.armedState.triggeredItems[item.id];

        if ((now.valueOf() - t.lastTriggered.valueOf()) / 1000 > 10)
          updateEvent = true;
        t.lastTriggered = now;
        ++t.count;
        this.armedState.notifyChanged();
      }
    }, this);

    if (updateEvent)
      this.armedState.updateLogEvent();

    this.prevDetected = {};
    _.forEach(this.arm.armedDetected, (e) => {
      this.prevDetected[e.id] = true;
    }, this);
  }
}
ruleEngineModule.defineRule({ruleClass: ArmHistory.prototype, depends: ['ArmedStates', 'Arm']});

//---------------------------------------------------------------------------------------------------------------------
class WouldTrigger extends ruleEngineModule.Rule {

  armedState:arming.ArmedState = serviceModule.Service.instance.armedStates.active;
  notified:{[key:string]:boolean} = {};
  arm:Arm = this.getRule(Arm.prototype);

  shouldRun():boolean {
    return super.shouldRun() && (
      serviceModule.Service.instance.armedStates.active.timeLeft > 0 ||
      serviceModule.Service.instance.armedStates.active != this.armedState) ||
      Object.keys(serviceModule.Service.instance.armedStates.active.wouldTriggerItems).length > 0;
  }

  run():void {
    if (serviceModule.Service.instance.armedStates.active != this.armedState) {
      this.armedState = serviceModule.Service.instance.armedStates.active;
      this.notified = {};
    }

    if (this.armedState.timeLeft == 0) {
      this.armedState.wouldTriggerItems = {};
      this.armedState.updateLogEvent();
    }

    var wouldTrigger:itemModule.Item[] = [];

    var updateEvent:boolean = false;

    _.forEach(this.arm.armedDetected, (item) => {
      if (this.armedState.bypassedItems[item.id])
        return;
      if (serviceModule.Service.instance.items.delayedArmed.at(item.id))
        return;

      if (!this.notified[item.id]) {
        notified[item.id] = true;
        wouldTrigger.push(item);
      }

      if (wouldTrigger.length == 0)
        return false;

      var now = new Date();
      _.forEach(wouldTrigger, (wtItem) => {
        var wouldTriggerItem:WouldTriggerItem = this.armedState.wouldTriggerItems[wtItem.id];
        if (!wouldTriggerItem) {
          wouldTriggerItem = new arming.WouldTriggerItem(wtItem);
          this.armedState.wouldTriggerItems [wtItem.id] = wouldTriggerItem;
        }

        wouldTriggerItem.lastTriggered = now;
        ++wouldTriggerItem.count;
        updateEvent = true;

      }, this);

      if (updateEvent)
        this.armedState.updateLogEvent();

    }, this);
  }
}
ruleEngineModule.defineRule({ruleClass: WouldTrigger.prototype, depends: ['ArmedStates', 'Arm']});

//---------------------------------------------------------------------------------------------------------------------
class NotifyMonitor extends ruleEngineModule.Rule {

  prevDetectedString:string = '';

  shouldRun():boolean {
    return super.shouldRun() && !U.isNullOrUndefined(serviceModule.Service.instance.pushNotification);
  }

  run():void {
    var detected = _.filter(serviceModule.Service.instance.items.monitor.allItems, (item) => item instanceof itemModule.Sensor && item.isDetected());

    if (detected.length == 0)
      return;
    var detectedString = detected.join(',');
    if (detectedString != this.prevDetectedString) {
      this.prevDetectedString = detectedString;
      //TODO fixme serviceModule.Service.instance.pushNotification.send(new Message ("Monitor Sensors Detected", detectedString, priority: Priority.HIGH));
    }
  }
}
ruleEngineModule.defineRule({ruleClass: NotifyMonitor.prototype, depends: ['monitor']});

//---------------------------------------------------------------------------------------------------------------------
class ActivateSiren extends ruleEngineModule.Rule {

  run():void {
    logger.info("here");
  }
}
ruleEngineModule.defineRule({ruleClass: ActivateSiren.prototype, depends: ['ArmedStates', 'Arm']});

//---------------------------------------------------------------------------------------------------------------------
class SensorHistory extends ruleEngineModule.Rule {

  run():void {
    logger.info("here");
  }
}
ruleEngineModule.defineRule({ruleClass: SensorHistory.prototype, depends: ['ArmedStates']});
