// GHome API Controller
var logger = require('../config/logger');

var ua = require('universal-analytics');
var Account = require('../models/account');
var oauthModels = require('../models/oauth');
var Devices = require('../models/devices');
var Topics = require('../models/topics');
var LostPassword =  require('../models/lostPassword');


module.exports = function(app, defaultLimiter, passport, mqttClient, logger){

var debug = (process.env.ALEXA_DEBUG || false);

// Need to import defaultLimiter, mqttClient, ongoingcommands +++++
if (process.env.GOOGLE_ANALYTICS_TID != undefined) {
    enableAnalytics = true;
    var visitor = ua(process.env.GOOGLE_ANALYTICS_TID);
}

/////////////////////// Start GHome
app.post('/api/v1/action', defaultLimiter,
	passport.authenticate(['bearer', 'basic'], { session: false }),
	function(req,res,next){
	logger.log('verbose', "[GHome API] Request:" + JSON.stringify(req.body));
	var intent = req.body.inputs[0].intent;
	var requestId = req.body.requestId;

	switch (intent) {
		///////////////////////////////////////////////////////////////////////////
		case 'action.devices.SYNC' :
			logger.log('verbose', "[GHome Sync API] Running device discovery for user:" + req.user.username);
			var params = {
				ec: "SYNC",
				ea: "GHome SYNC event for username: " + req.user.username,
				uid: req.user.username,
				uip: req.ip,
				dp: "/api/v1/action"
			  }
			if (enableAnalytics) {visitor.event(params).send()};

			if (debug == "true") {console.time('ghome-sync')};
			var findUser = Account.find({username: req.user.username});
			var findDevices = Devices.find({username: req.user.username});
			Promise.all([findUser, findDevices]).then(([user, devices]) => {
				if (user && devices) {
					logger.log('debug', "[GHome Sync API] User: " + JSON.stringify(user[0]));
					logger.log('debug', "[GHome Sync API] Devices: " + JSON.stringify(devices));
					// Build Device Array
					var devs = [];
					for (var i=0; i< devices.length; i++) {
						var deviceJSON = JSON.parse(JSON.stringify(devices[i])); 
						var dev = {}
						dev.id = "" + devices[i].endpointId;
						dev.type = gHomeReplaceType(devices[i].displayCategories);
						dev.traits = [];
						// Check supported device type
						if (dev.type != "NA") {
							// Check supported capability/ trait
							devices[i].capabilities.forEach(function(capability){
								var trait = gHomeReplaceCapability(capability);
								// Add supported traits, don't add duplicates
								if (trait != "Not Supported" && dev.traits.indexOf(trait) == -1){
									dev.traits.push(trait);
								}
							});
						}
						dev.name = {
							name : devices[i].friendlyName
							}
						dev.willReportState = devices[i].reportState;
						dev.attributes = devices[i].attributes;
						// Populate attributes, remap roomHint to device root
						if (deviceJSON.hasOwnProperty('attributes')) {
							if (deviceJSON.attributes.hasOwnProperty('roomHint')){
								delete dev.attributes.roomHint;
								if (deviceJSON.attributes.roomHint != ""){dev.roomHint = deviceJSON.attributes.roomHint};
							}
						}
						// Add colorModel attribute if color is supported interface/ trait
						if (devices[i].capabilities.indexOf("ColorController") > -1 ){
							dev.attributes.colorModel = "hsv";
							delete dev.attributes.commandOnlyColorSetting; // defaults to false anyway
						}
						// Pass min/ max values as float
						if (devices[i].capabilities.indexOf("ColorTemperatureController") > -1 ){
							dev.attributes.colorTemperatureRange.temperatureMinK = parseInt(dev.attributes.colorTemperatureRange.temperatureMinK);
							dev.attributes.colorTemperatureRange.temperatureMaxK = parseInt(dev.attributes.colorTemperatureRange.temperatureMaxK);
						}

						// action.devices.traits.TemperatureSetting, adjust dev.attributes to suit Google Home
						if (dev.traits.indexOf("action.devices.traits.TemperatureSetting") > -1 ){
							//dev.attributes.availableThermostatModes = dev.attributes.thermostatModes.map(function(x){return x.toLowerCase()});
							dev.attributes.availableThermostatModes = dev.attributes.thermostatModes.join().toLowerCase(); // Make string, not array
							dev.attributes.thermostatTemperatureUnit = dev.attributes.temperatureScale.substring(0, 1); // >> Need to make this upper F or C, so trim
							delete dev.attributes.temperatureRange;
							delete dev.attributes.temperatureScale;
							delete dev.attributes.thermostatModes;
						}
						dev.deviceInfo = {
							manufacturer : "Node-RED",
							model : "Node-RED",
							hwVersion : "0.1",
							swVersion : "0.1"
						}
						// Limit supported traits, don't add other device types
						if (dev.traits.length > 0 && dev.type != "NA") {
							devs.push(dev);
						}
					}

					// Build Response
					var response = {
						"requestId": requestId,
						"payload": {
							"agentUserId": user[0]._id,
							"devices" : devs
						}
					}
					logger.log('verbose', "[GHome Sync API] Discovery Response: " + JSON.stringify(response));
					// Send Response
					res.status(200).json(response);
					if (debug == "true") {console.timeEnd('ghome-sync')};
				}
				else if (!user){
					logger.log('warn', "[GHome Sync API] User not found");
					res.status(500).json({message: "User not found"});
					if (debug == "true") {console.timeEnd('ghome-sync')};
				}
				else if (!device) {
					logger.log('warn', "[GHome Sync API] Device not found");
					res.status(500).json({message: "Device not found"});
					if (debug == "true") {console.timeEnd('ghome-sync')};
				}
			}).catch(err => {
				logger.log('error', "[GHome Sync API] error:" + err)
				res.status(500).json({message: "An error occurred."});
				if (debug == "true") {console.timeEnd('ghome-sync')};
			});
			break;

		///////////////////////////////////////////////////////////////////////////
		case 'action.devices.EXECUTE' : 
			logger.log('verbose', "[GHome Exec API] Execute command for user:" + req.user.username);
			var params = {
				ec: "EXECUTE",
				ea: "GHome EXECUTE event for username: " + req.user.username,
				uid: req.user.username,
				uip: req.ip,
				dp: "/api/v1/action"
			  }
			if (enableAnalytics) {visitor.event(params).send()};

			if (debug == "true") {console.time('ghome-exec')};
			var findDevices = Devices.find({username: req.user.username});
			Promise.all([findUser, findDevices]).then(([user, devices]) => {
				if (devices) {
					var arrCommands = req.body.inputs[0].payload.commands; // Array of commands, assume match with device array at same index?!
					logger.log('debug', "[GHome Exec API] Returned mongodb devices typeof:" + typeof devices);
					//var devicesJSON = JSON.parse(JSON.stringify(devices));
					//logger.log('debug', "[GHome Exec API] User devices:" + JSON.stringify(devicesJSON));
					for (var i=0; i< arrCommands.length; i++) { // Iterate through commands in payload, against each listed 
						var arrCommandsDevices =  req.body.inputs[0].payload.commands[i].devices; // Array of devices to execute commands against
						var params = arrCommands[i].execution[0].params; // Google Home Parameters
						var validationStatus = true;
						// Match device to returned array in case of any required property/ validation
						arrCommandsDevices.forEach(function(element) {
							//logger.log('debug', "[GHome Exec API] Attempting to matching command device: " + element.id + ", against devicesJSON");
							var data = devices.find(obj => obj.endpointId == element.id);
							if (data == undefined) {logger.log('debug', "[GHome Exec API] Failed to match device against devicesJSON")}
							else {logger.log('debug', "[GHome Exec API] Executing command against device:" + JSON.stringify(data))}
							// Handle Thermostat valueOutOfRange
							if (arrCommands[i].execution[0].command == "action.devices.commands.ThermostatTemperatureSetpoint") {
								var hastemperatureMax = getSafe(() => data.attributes.temperatureRange.temperatureMax);
								var hastemperatureMin = getSafe(() => data.attributes.temperatureRange.temperatureMin);
								if (hastemperatureMin != undefined && hastemperatureMax != undefined) {
									var temperatureMin = data.attributes.temperatureRange.temperatureMin;
									var temperatureMax = data.attributes.temperatureRange.temperatureMax;
									logger.log('debug', "[GHome Exec API] Checking requested setpoint: " + params.thermostatTemperatureSetpoint + " , againast temperatureRange, temperatureMin:" + hastemperatureMin + ", temperatureMax:" + temperatureMax);
									if (params.thermostatTemperatureSetpoint > temperatureMax || params.thermostatTemperatureSetpoint < temperatureMin){
										// Build valueOutOfRange error response
										validationStatus = false;
										logger.log('warn', "[GHome Exec API] Temperature valueOutOfRange error for endpointId:" + element.id);
										// Global error response
										var errResponse = {
											"requestId": req.body.requestId,
											"payload": {
												"errorCode": "valueOutOfRange"
											}
										}
										logger.log('debug', "[GHome Exec API] valueOutOfRange error response:" + JSON.stringify(errResponse));
										res.status(200).json(errResponse);
									}
								}
							}
							// Handle Color Temperature valueOutOfRange
							if (arrCommands[i].execution[0].command == "action.devices.commands.ColorAbsolute") {
								var hastemperatureMaxK = getSafe(() => data.attributes.colorTemperatureRange.temperatureMaxK);
								var hastemperatureMinK = getSafe(() => data.attributes.colorTemperatureRange.temperatureMinK);
								if (hastemperatureMinK != undefined && hastemperatureMaxK != undefined) {
									var temperatureMinK = data.attributes.colorTemperatureRange.temperatureMinK;
									var temperatureMaxK = data.attributes.colorTemperatureRange.temperatureMaxK;
									logger.log('debug', "[GHome Exec API] Checking requested setpoint: " + params.color.temperature + " , againast temperatureRange, temperatureMin:" + hastemperatureMin + ", temperatureMax:" + temperatureMax);
									if (params.color.temperature > temperatureMaxK || params.color.temperature < temperatureMinK){
										// Build valueOutOfRange error response
										validationStatus = false;
										logger.log('warn', "[GHome Exec API] valueOutOfRange error for endpointId:" + element.id);
										// Global error response
										var errResponse = {
											"requestId": req.body.requestId,
											"payload": {
												"errorCode": "valueOutOfRange"
											}
										}
										logger.log('debug', "[GHome Exec API] Color Temperature valueOutOfRange error response:" + JSON.stringify(errResponse));
										res.status(200).json(errResponse);
									}
								}
							}
							if (validationStatus == true) {
								logger.log('debug', "[GHome Exec API] Command to be executed against endpointId:" + element.id);
								// Set MQTT Topic
								var topic = "command/" + req.user.username + "/" + element.id;
								try{
									// Define MQTT Message
									var message = JSON.stringify({
										requestId: requestId,
										id: element.id,
										execution: arrCommands[i]
									});
									mqttClient.publish(topic,message); // Publish Command
									logger.log('verbose', "[GHome Exec API] Published MQTT command for user: " + req.user.username + " topic: " + topic);
									logger.log('debug', "[GHome Exec API] MQTT message:" + message);

								} catch (err) {
									logger.log('warn', "[GHome Exec API] Failed to publish MQTT command for user: " + req.user.username);
									logger.log('debug', "[GHome Exec API] Publish MQTT command error: " + err);
								}
								// Build success response and include in onGoingCommands
								var response = {
									requestId: requestId,
									payload: {
										commands: [{
											ids: [element.id],
											status: "SUCCESS",
											state: params
										}]
									}
								}
								var command = {
									user: req.user.username,
									res: res,
									response: response,
									source: "Google",
									timestamp: Date.now()
								};
								onGoingCommands[requestId] = command; // Command drops into buffer w/ 6000ms timeout (see defined funcitonm above) - ACK comes from N/R flow
							}
						});
					}
					if (debug == "true") {console.timeEnd('ghome-exec')};
				}
				else if (!device) {
					logger.log('warn', "[GHome Exec API] Device not found");
					res.status(500).json({message: "Device not found"});
					if (debug == "true") {console.timeEnd('ghome-exec')};
				}
			}).catch(err => {
				logger.log('error', "[GHome Exec API] error:" + err)
				res.status(500).json({message: "An error occurred."});
				if (debug == "true") {console.timeEnd('ghome-exec')};
			});

			break;

		///////////////////////////////////////////////////////////////////////////
		case 'action.devices.QUERY' :
			logger.log('verbose', "[GHome Query API] Running device state query for user:" + req.user.username);

			var params = {
				ec: "QUERY",
				ea: "GHome QUERY event for username: " + req.user.username,
				uid: req.user.username,
				uip: req.ip,
				dp: "/api/v1/action"
			  }
			if (enableAnalytics) {visitor.event(params).send()};

			if (debug == "true") {console.time('ghome-query')};
			var findUser = Account.find({username: req.user.username});
			var findDevices = Devices.find({username: req.user.username});
			Promise.all([findUser, findDevices]).then(([user, devices]) => {
				if (user && devices) {
					var arrQueryDevices = req.body.inputs[0].payload.devices;
					var response = {
						"requestId": requestId,
						"payload": {
							"devices" : {}
						}
					}
					for (var i=0; i< arrQueryDevices.length; i++) {
						// Find device in array of user devices returned in promise
						logger.log('debug', "[GHome Query API] Trying to match requested device: " + arrQueryDevices[i].id + " with user-owned endpointId");	
						var data = devices.find(obj => obj.endpointId == arrQueryDevices[i].id);
						if (data) {
							logger.log('verbose', "[GHome Query API] Matched requested device: " + arrQueryDevices[i].id + " with user-owned endpointId: " + data.endpointId);	
							// Create initial JSON object for device
							response.payload.devices[data.endpointId] = {online: true};
							// Add state response based upon device traits
							data.capabilities.forEach(function(capability){
								var trait = gHomeReplaceCapability(capability);

								// Limit supported traits, add new ones here once SYNC and gHomeReplaceCapability function updated
								if (trait == "action.devices.traits.Brightness"){
									response.payload.devices[data.endpointId].brightness = data.state.brightness;
								}
								if (trait == "action.devices.traits.ColorSetting") {
									if (!response.payload.devices[data.endpointId].hasOwnProperty('on')){
										response.payload.devices[data.endpointId].on = data.state.power.toLowerCase();
									}
									if (data.capabilities.indexOf('ColorController') > -1 ){
										response.payload.devices[data.endpointId].color = {
											"spectrumHsv": {
												"hue": data.state.colorHue,
												"saturation": data.state.colorSaturation,
												"value": data.state.colorBrightness
											  }
										}
									}
									if (data.capabilities.indexOf('ColorTemperatureController') > -1){
										var hasColorElement = getSafe(() => response.payload.devices[data.endpointId].color);
										if (hasColorElement != undefined) {response.payload.devices[data.endpointId].color.temperatureK = data.state.colorTemperature}
										else {
											response.payload.devices[data.endpointId].color = {
												"temperatureK" : data.state.colorTemperature
											}
										}
									}
								}
								if (trait == "action.devices.traits.OnOff") {
									if (data.state.power.toLowerCase() == 'on') {
										response.payload.devices[data.endpointId].on = true;
									}
									else {
										response.payload.devices[data.endpointId].on = false;
									}
									
								}
								// if (trait == "action.devices.traits.Scene") {} // Only requires 'online' which is set above
								if (trait == "action.devices.traits.TemperatureSetting") {
									response.payload.devices[data.endpointId].thermostatMode = data.state.thermostatMode.toLowerCase();
									response.payload.devices[data.endpointId].thermostatTemperatureSetpoint = data.state.thermostatSetPoint;
									if (data.state.hasOwnProperty('temperature')) {
										response.payload.devices[data.endpointId].thermostatTemperatureAmbient = data.state.temperature;
									}
								}
							});
						}
						else {
							logger.log('warn', "[GHome Query API] Unable to match a requested device with user endpointId");
						}
					}
					// Send Response
					logger.log('verbose', "[GHome Query API] QUERY state: " + JSON.stringify(response));
					res.status(200).json(response);
					if (debug == "true") {console.timeEnd('ghome-query')};
				}
				else if (!user){
					logger.log('warn', "[GHome Query API] User not found");
					res.status(500).json({message: "User not found"});
					if (debug == "true") {console.timeEnd('ghome-query')};
				}
				else if (!device) {
					logger.log('warn', "[GHome Query API] Device not found");
					res.status(500).json({message: "Device not found"});
					if (debug == "true") {console.timeEnd('ghome-query')};
				}

			}).catch(err => {
				logger.log('error', "[GHome Query API] error:" + err)
				res.status(500).json({message: "An error occurred."});
				if (debug == "true") {console.timeEnd('ghome-query')};
			});
			break;

		///////////////////////////////////////////////////////////////////////////
		case 'action.devices.DISCONNECT' : 
			// Find service definition with Google URLs
			var userId = req.user._id;
			var params = {
				ec: "DISCONNECT",
				ea: "GHome Disconnect event for username: " + req.user.username,
				uid: req.user.username,
				uip: req.ip,
				dp: "/api/v1/action"
			  }
			if (enableAnalytics) {visitor.event(params).send()};

			oauthModels.Application.findOne({domains: "oauth-redirect.googleusercontent.com" },function(err, data){
				if (data) {
					// Remove OAuth tokens for **Google Home** only
					logger.log('debug', "[GHome Disconnect API] Disconnect request for userId:" + userId + ", application:" + data.title);
					var grantCodes = oauthModels.GrantCode.deleteMany({user: userId, application: data._id});
					var accessTokens = oauthModels.AccessToken.deleteMany({user: userId, application: data._id});
					var refreshTokens = oauthModels.RefreshToken.deleteMany({user: userId, application: data._id});
					Promise.all([grantCodes, accessTokens, refreshTokens]).then(result => {
						logger.log('info', "[GHome Disconnect API] Deleted GrantCodes, RefreshToken and AccessTokens for user account: " + userId)
						res.status(200).send();
					}).catch(err => {
					 	logger.log('warn', "[GHome Disconnect API] Failed to delete GrantCodes, RefreshToken and AccessTokens for user account: " + userId);
					 	res.status(500).json({error: err});
					});
				}
			});
			break; 
	}
});


///////////////////////////////////////////////////////////////////////////
// MQTT Message Handlers
///////////////////////////////////////////////////////////////////////////
var onGoingCommands = {};

// Event handler for received MQTT messages - note subscribe near top of script.
mqttClient.on('message',function(topic,message){
	var arrTopic = topic.split("/"); 
	var username = arrTopic[1];
	var endpointId = arrTopic[2];

	if (topic.startsWith('response/')){
		logger.log('info', "[Command API] Acknowledged MQTT response message for topic: " + topic);
		if (debug == "true") {console.time('mqtt-response')};
		var payload = JSON.parse(message.toString());
		//console.log("response payload", payload)
		var commandWaiting = onGoingCommands[payload.messageId];
		if (commandWaiting) {
			//console.log("mqtt response: " + JSON.stringify(payload,null," "));
			if (payload.success) {
				// Google Home success response
				if (commandWaiting.hasOwnProperty('source') && commandWaiting.source == "Google") {
					logger.log('debug', "[Command API] Successful Google Home MQTT command, response: " + JSON.stringify(commandWaiting.response));
					commandWaiting.res.status(200).json(commandWaiting.response);
				}
				// Alexa success response send to Lambda for full response construction
				else {
					if (commandWaiting.hasOwnProperty('response')) {
						logger.log('debug', "[Command API] Successful Alexa MQTT command, response: " + JSON.stringify(commandWaiting.response));
						commandWaiting.res.status(200).json(commandWaiting.response)
					}
					else {
						logger.log('debug', "[Command API] Alexa MQTT command successful");
						commandWaiting.res.status(200).send()
					}
				}			
			} else {
				// Google Home failure response
				if (commandWaiting.hasOwnProperty('source') && commandWaiting.source == "Google") {
					delete commandWaiting.response.state;
					commandWaiting.response.status = "FAILED";
					logger.log('warn', "[Command API] Failed Google Home MQTT command, response: " + JSON.stringify(commandWaiting.response));
					commandWaiting.res.status(200).json(commandWaiting.response);
				}
				// Alexa failure response send to Lambda for full response construction
				else {
					if (commandWaiting.hasOwnProperty('response')) {
						logger.log('warn', "[Command API] Failed Alexa MQTT Command API, response:" + + JSON.stringify(commandWaiting.response));
						commandWaiting.res.status(503).json(commandWaiting.response)
					}
					else {
						logger.log('warn', "[Command API] Failed Alexa MQTT Command API response");
						commandWaiting.res.status(503).send()
					}
				}
			}
			delete onGoingCommands[payload.messageId];
			var params = {
				ec: "Command",
				ea: "Command API successfully processed MQTT command for username: " + username,
				uid: username,
			  }
			if (enableAnalytics) {visitor.event(params).send()};
		}
		if (debug == "true") {console.timeEnd('mqtt-response')};
	}
	else if (topic.startsWith('state/')){
		logger.log('info', "[State API] Acknowledged MQTT state message topic: " + topic);
		if (debug == "true") {console.time('mqtt-state')};
		// Split topic/ get username and endpointId
		var messageJSON = JSON.parse(message);
		var payload = messageJSON.payload;
		// Call setstate to update attribute in mongodb
		setstate(username,endpointId,payload) //arrTopic[1] is username, arrTopic[2] is endpointId
		// Add message to onGoingCommands
		var stateWaiting = onGoingCommands[payload.messageId];
		if (stateWaiting) {
			if (payload.success) {
				logger.log('info', "[State API] Succesful MQTT state update for user:" + username + " device:" + endpointId);
				stateWaiting.res.status(200).send();
			} else {
				logger.log('warn', "[State API] Failed MQTT state update for user:" + username + " device:" + endpointId);
				stateWaiting.res.status(503).send();
			}
		}
		// If successful remove messageId from onGoingCommands
		delete onGoingCommands[payload.messageId];
		var params = {
			ec: "Set State",
			ea: "State API successfully processed MQTT state for username: " + username + " device: " + endpointId,
			uid: username,
		  }
		if (enableAnalytics) {visitor.event(params).send()};
		if (debug == "true") {console.timeEnd('mqtt-state')};
	}
	else {
		logger.log('debug', "[MQTT] Unhandled MQTT via on message event handler: " + topic + message);
	}
});

// Interval funciton, runs every 500ms once defined via setInterval: https://www.w3schools.com/js/js_timing.asp
var timeout = setInterval(function(){
	var now = Date.now();
	var keys = Object.keys(onGoingCommands);
	for (key in keys){
		var waiting = onGoingCommands[keys[key]];
		logger.log('debug', "[MQTT] Queued MQTT message: " + keys[key]);
		if (waiting) {
			var diff = now - waiting.timestamp;
			if (diff > 6000) {
				logger.log('warn', "[MQTT] MQTT command timed out/ unacknowledged: " + keys[key]);
				waiting.res.status(504).send('{"error": "timeout"}');
				delete onGoingCommands[keys[key]];
				//measurement.send({
				//	t:'event', 
				//	ec:'command', 
				//	ea: 'timeout',
				//	uid: waiting.user
				//});
			}
		}
	}
},500);

// Convert Alexa Device Capabilities to Google Home-compatible
function gHomeReplaceCapability(capability) {
	// Limit supported traits, add new ones here
	if(capability == "PowerController") {return "action.devices.traits.OnOff"}
	else if(capability == "BrightnessController")  {return "action.devices.traits.Brightness"}
	else if(capability == "ColorController" || capability == "ColorTemperatureController"){return "action.devices.traits.ColorSetting"}
	else if(capability == "SceneController") {return "action.devices.traits.Scene"}
	else if(capability == "ThermostatController")  {return "action.devices.traits.TemperatureSetting"}
	else {return "Not Supported"}
}

// Convert Alexa Device Types to Google Home-compatible
function gHomeReplaceType(type) {
	// Limit supported device types, add new ones here
	if (type == "ACTIVITY_TRIGGER") {return "action.devices.types.SCENE"}
	else if (type == "LIGHT") {return "action.devices.types.LIGHT"}
	else if (type == "SMARTPLUG") {return "action.devices.types.OUTLET"}
	else if (type == "SWITCH") {return "action.devices.types.SWITCH"}
	else if (type.indexOf('THERMOSTAT') > -1) {return "action.devices.types.THERMOSTAT"}
	else {return "NA"}
}
/////////////////////// End GHome

}