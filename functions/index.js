// Import required libraries.
const functions = require('firebase-functions'); // Firebase cloud functions
const http_req = require('request-promise');  // Request module for outbound HTTP calls

/**
 * Get HubSpot API Key and table ID from Firebase environment variable
 * To set environment variable: 
 *   # firebase functions:config:set hubspot.apikey="[api key]"
 *   # firebase functions:config:set hubspot.table_id="[table id]"
 * Use inspect environment variables: 
 *   # firebase functions:config:get
 */
const hapikey = functions.config().hubspot.apikey;
const table_id = functions.config().hubspot.table_id;

/**
 * Implement a ping request
 * ----------------------------------------
 * Try: https://[your-app].firebaseapp.com/ping
 * or with get parameters: https://[your-app].firebaseapp.com/ping?myvar=abc
 */
exports.ping = functions.https.onRequest((req, res) => {

  // Return any parameters passed in
  if (Object.entries(req.query).length !== 0 && req.query.constructor === Object) {
     return res.status(200)
        .json({"request": req.query});
  }

  // Default response
  return res.status(200)
    .json({"request":"Thanks for the ping! Send parameters to see them returned to you."});
});


/**
 * Implement updateSlot endpoint 
 * Type: POST request
 */
exports.updateSlot = functions.https.onRequest((req, res) => {

    // Check for POST request 
    if (req.method !== "POST") {
        res.status(400).send('Please send a POST request.');
        return;
    }


    /**
     * Our process is as follows:
     *  1. Look up the time slot row in the HubDB table using the time slot row_id from 
     *     contact record (which was updated by the form submission)
     *  2. Once we get the row, we lookup the qty_available field of that row and 
     *     save the value.
     *     To get at that field, we need to know the designated HubDB cell ID of that column.
     *     We can call this URL (using Postman or browser) to get that information:
     *       https://api.hubapi.com/hubdb/api/v2/tables/[table id]?portalId=[portal_id]
     *     The results will be the structure of the table. Look up that column and it
     *     will have the cell_id: https://sg.d.pr/e4nTve
     *  3. Next, we decrement the qty value and update the row with it.
     *  4. Finally, we publish the table.
     */
         
    /**
     * Get the contactdata that is POST'ed to us. The HS Workflow that calls this 
     * endpoint will send the HS contact record as the data.
     */
    let contact_data = req.body;
    
    // Find the time slot row ID from the contact data. Return 400 if not found or valid.
    let row_id = 0;
    try {
        row_id = contact_data.properties.volunteer_slot_date_time_id.value;
    } catch(err) {
        res.status(400).send('No time slot id found.');
        return;
    }        
    if (typeof(row_id) === undefined || !row_id ) {
        res.status(400).send('No time slot id defined.');
    }
            
    // Construct the base URL of our API calls    
    let hubdb_url = `https://api.hubapi.com/hubdb/api/v2/tables/${table_id}`;    
    // The qty_available cell ID for our table is 1.
    let qty_available_cell_id = 1;    
    // API URL to get the row
    let hubdb_get_row_url = hubdb_url + `/rows/${row_id}?hapikey=${hapikey}`;
    // API URL to get update the row
    let hubdb_update_row_url = 
        hubdb_url + `/rows/${row_id}/cells/${qty_available_cell_id}?hapikey=${hapikey}`;
    // API URL to publish the table
    let hubdb_publish_url = hubdb_url + `/publish?hapikey=${hapikey}`;

    // Issue GET request to get the table row
    http_req.get({url:hubdb_get_row_url,json:true})
    .then(function (data) {
    
        /* Data returned example:
            {
                "id": 12245072310,
                "createdAt": 1566251682040,
                "path": null,
                "name": null,
                "values": {
                    "1": 4,
                    "2": 1569916800000
                },
                "childTableId": 0,
                "isSoftEditable": false
            }
        */    
        let qty_available = data.values[qty_available_cell_id];
        
        // Decrement quantity available, that will be the new value
        let new_value = { "value" : --qty_available };

        // Now we will update the row in HubDB with that new qty value
        // PUT /hubdb/api/v2/tables/:tableId/rows/:rowId/cells/:cellId
        http_req.put({url:hubdb_update_row_url,json:new_value})
        .then(function(data) {

            // Now that row has been updated, we will publish the table so the updated data is availble.
            http_req.put({url:hubdb_publish_url})
            .then(function(data) {
            
                // Publish successful.
                res.send(`Row ID ${row_id} updated successfully to ${qty_available} and table was published.`);
                
            }).catch(function(err){            
                // Publish failed.
                res.status(500).send(`Row ID ${row_id} updated successfully to ${qty_available} but table was NOT able to be published!`);                
            });     
            
        }).catch(function(err){
            res.status(404).send('Cannot update row ID ' + row_id + ' with value ' + qty_available);
        }); 
        
    }).catch(function(err){
        res.status(404).send('Cannot find row ID ' + row_id);
    });       
});