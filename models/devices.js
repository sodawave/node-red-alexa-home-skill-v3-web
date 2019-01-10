var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var AutoIncrement = require('mongoose-sequence')(mongoose);

var Devices = new Schema({
    username: String,
    endpointId: Number,
    friendlyName: String,
    description: String,
    capabilities: [],
    displayCategories: [String],
    validRange: {
        minimumValue: Number,
        maximumValue: Number,
        scale: String
    },
    cookie: {
    	extraDetail1: String,
    	extraDetail2: String,
    	extraDetail3: String,
    	extraDetail4: String
    },
    reportState: Boolean,
    state: Schema.Types.Mixed,
    attributes : Schema.Types.Mixed,
    room : String
});

Devices.plugin(AutoIncrement, {inc_field: 'endpointId'});

module.exports = mongoose.model('Devices', Devices);

    // attributes{..} will replace validRange { minimumValue, maximumValue, scale}
    // attributes : {
    //     colorModel: String,
    //     colorTemperatureRange: {
    //         temperatureMinK: Number,
    //         temperatureMaxK: Number
    //     },
    //     temperatureRange: {
    //         temperatureMin: Number,
    //         temperatureMax: Number,
    //         scale: String       
    //     },
    //     temperatureScale: String,
    //     thermostatModes: [],
    //     availableModes: Schema.Types.Mixed,
    //     availableToggles: Schema.Types.Mixed,
    //     availableFanSpeeds: Schema.Types.Mixed,
    //     sceneReversible: Boolean
    // }