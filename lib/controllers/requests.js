var dotenv = require('node-env-file'),
    request = require('request'),
    moment = require('moment'),
    ObjectId = require('mongoose').Types.ObjectId,
    env = process.env.NODE_ENV || 'development',
    config = require('../../config/config')[env],
    geolocator = require('../util/geolocator'),
    User = require('../models/User'),
    Request = require('../models/Request'),
    Trip = require('../models/Trip');

if (env === 'development') {
    dotenv(__dirname + '/.env');
}

function listAll(req, res) {
    var id, requests,
        uuid = req.params.uuid,
        userRequests = [];

    // return requests for a particular user
    User.findOne({ _id: uuid })
    .where('active')
    .equals(true)
    .exec(function (err, user) {
        if (err) {
            return res.status(400).json({ message: 'An error occurred with this request. Please try again later.', error: err });
        }

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        Request.find({ user: new ObjectId(uuid) })
        .where('active')
        .equals(true)
        .exec(function (err, requests) {
            if (err) {
                return res.status(400).json({ message: 'An error occurred with this request. Please try again later.', error: err });
            }

            if (!requests.length) {
                return res.status(404).json({ message: 'This user has no requests available.' });                
            }

            return res.status(200).json({ message: 'Successfully retrieved requests for this user.', response: requests });
        });
    });
}

function createRequest(req, res) {
    var i, user, params, product, products,
        uuid = req.params.uuid,
        data = req.body;

    if (!data || !data.start || !data.start.time  || !data.start.location || !data.productType || !data.end || !data.end.location) {
        res.status(400).json({ error: 'Invalid request!' });
    }

    geolocator(data.start.location, function (err, coords) {
        if (err) {
            return res.status(400).json({ error: err });
        }

        data.start.location = {
            address     : coords.results[0].formatted_address,
            latitude    : coords.results[0].geometry.location.lat,
            longitude   : coords.results[0].geometry.location.lng
        };

        User.findOne({ _id: uuid })
        .where('active')
        .equals(true)
        .exec(function (err, user) {
            if (err) {
                return res.status(400).json({ message: 'An error occurred with this request. Please, try again later.', error: err });
            }

            if (!user) {
                return res.status(400).json({ message: 'This user cannot be found. Please, try again later.'});
            }

            data.uid = uuid;
            params = {
                url: config.uber.base_uber_url + 'products',
                qs: {
                    server_token    : process.env.UBER_SERVER_TOKEN,
                    latitude        : data.start.location.latitude,
                    longitude       : data.start.location.longitude
                }
            };

            request.get(params, function (err, status, body) {
                if (err) {
                    return res.status(400).json({ message: 'An error occurred with this request. Please, try again later.'});
                }

                body = JSON.parse(body);
                products = body.products;

                for (i in products) {
                    if (products[i].display_name === data.productType) {
                        product = products[i];
                    }
                }

                data.uber = {
                    id: product.product_id,
                    product: data.productType
                };

                delete data.productType;

                geolocator(data.end.location, function (err, coords) {
                    if (err) {
                        return res.status(400).json({ message: 'An error occurred with this request. Please, try again later.', error: err });
                    }

                    data.end.location = {
                        address     : coords.results[0].formatted_address,
                        latitude    : coords.results[0].geometry.location.lat,
                        longitude   : coords.results[0].geometry.location.lng
                    };

                    // Set the params object for making a call to Uber's Estimate endpoint
                    params.url = config.uber.base_uber_url + 'requests/estimate';
                    params.headers = {
                        'Authorization': 'Bearer ' + user.accessToken,
                        'Content-Type': 'application/json'
                    };

                    params.body = JSON.stringify({
                        product_id          : data.uber.id,
                        start_latitude      : data.start.location.latitude,
                        start_longitude     : data.start.location.longitude,
                        end_latitude        : data.end.destination.latitude,
                        end_longitude       : data.end.destination.longitude
                    });

                    params.qs = {};

                    // Get the estimated duration for the requested trip
                    request.post(params, function (err, status, body)  {
                        var pickup_estimate, time;

                        if (err) {
                            return res.status(400).json({ message: 'An error occurred with estimates calculation. Please, try again later.', error: err });
                        }

                        if (!body) {
                            return res.status(400).json({ message: 'Unable to calculate estimates! Please, try again later!' });
                        }

                        body = JSON.parse(body);

                        if (!body.trip || !body.pickup_estimate) {
                            return res.status(400).json({ message: 'Unable to get estimates! Please, try again later!' });
                        }

                        pickup_estimate = body.pickup_estimate;
                        time = moment(data.start.time).subtract(15, 'minutes').format();

                        data.uber.duration = body.trip.duration_estimate;
                        data.uber.reminder = moment(time).subtract(data.uber.duration, 'seconds').format();

                        new Request(data).save(function (err, request_body) {
                            if (err) {
                                return res.status(400).json({ message: 'An error occurred with this request. Please, try again later.', error: err });
                            }

                            return res.status(200).json({ message: 'Request was successfully created.', response: request_body });
                        });
                    });
                });
            });
        });
    });
}
    
function listOne(req, res) {
    var user, userTrips, trip, requestData,
        uuid = req.params.uuid,
        id = req.params.req_id,
        params = {};

    // Find the user from the database with the user's id
    User.findOne({ _id: uuid })
    .where('active')
    .equals(true)
    .exec(function (err, user) {
        if (err) {
            return res.status(400).json({ message: 'An error occurred with this request. Please, try again later.', error: err });
        }

        if (!user) {
            return res.status(404).json({ message: 'This user is not available.' });
        }

        Request.findOne({ _id: id })
        .exec(function (err, request_data) {
            if (err) {
                return res.status(400).json({ message: 'An error occurred with this request. Please, try again later.', error: err });
            }

            if (!request_data) {
                return res.status(404).json({ message: 'Request not found.' });
            }

            Trip.findOne({ request: new ObjectId(id) })
            .exec(function (err, trip) {
                if (err) {
                    return res.status(400).json({ message: 'An error occurred with this request. Please, try again later.', error: err });
                }

                if (!trip) {
                    return res.status(200).json({ message: 'Successfully returned request data.', response: request_data });
                }

                // Set the params object for making a call to Uber's Estimate endpoint
                params.url = config.uber.sandbox_base_url + 'requests/' + trip.request_id;
                params.headers = {
                    'Authorization': 'Bearer ' + user.accessToken,
                    'Content-Type': 'application/json'
                };

                request.get(params, function (err, status, body) {
                    if (err) {
                        return res.status(400).json({ error: 'An error occurred with this request. Please, try again later.' });
                    }

                    request_data.trip = JSON.parse(body) || null;

                    return res.json({ message: 'Successfully returned request data.', response: request_data });
                });
            });
        });
    });
}

function deleteOne(req, res) {
    var user, trip, trips,
        params = {},
        uuid = req.params.uuid,
        id  = req.params.id;

    // delete an existing request
    User.findOne({ _id: uuid })
    .where('active')
    .equals(true)
    .exec(function (err, user) {
        if (err) {
            return res.status(400).json({ message: 'An error occurred with this request. Please, try again later.', error: err });
        }

        if (!user) {
            return res.status(404).json({ message: 'This user is not available.' });
        }

        Request.findOne({ _id: new ObjectId(id) })
        .where('active')
        .equals(true)
        .exec(function (err, request_data) {
            if (err) {
                return res.status(400).json({ message: 'An error occurred with this request. Please, try again later.', error: err });
            }

            if (!request_data) {
                return res.status(404).json({ message: 'Reuqest was not found.' });
            }

            Trip.findOne({ request: new ObjectId(id) })
            .exec(function (err, trip) {
                if (err) {
                    return res.status(400).json({ message: 'An error occurred with this request. Please, try again later.', error: err });
                }

                if (!trip) {
                    return res.status(400).json({ message: 'Unable to complete this request. Please, try again later.' });
                }

                params.url = config.uber.sandbox_base_url + 'requests/' + trip.request_id;
                params.headers = {
                    'Authorization': 'Bearer ' + user.accessToken,
                    'Content-Type': 'application/json'
                };

                // Make a delete request to uber's api to delete the request
                request.del(params, function (err, response, body) {
                    if (err) {
                        return res.status(400).json({ message: 'Unable to cancel the trip!', error: err });
                    }

                    if (response.statusCode !== 204) {
                        return res.status(400).json({ message: 'Unable to cancel this request!' });    
                    }

                    request_data.active = false;
                    request_data.save(function (err, requestData) {
                        if (err) {
                            return res.status(400).json({ message: 'Unable to cancel this request. Please, try again later.', error: err });
                        }

                        return res.status(200).json({ message: 'Successfully cancelled this request.', response: requestData });
                    });
                });

            });
        });
    });
}

module.exports = {
    create      : createRequest,
    listOne     : listOne,
    listAll     : listAll,
    deleteOne   : deleteOne
};
