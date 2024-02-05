require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { google } = require('googleapis');
const cors = require('cors');
const mysql = require('mysql');
const fetch = require('node-fetch');

const app = express();

// Enable CORS for all routes
app.use(cors());

// Database connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});

db.connect((err) => {
  if (err) {
    console.error('Error connecting to the database:', err);
    return;
  }
  console.log('Database connected successfully');
});

// Middleware to parse JSON bodies
app.use(express.json());

// Endpoint for dropdown-search api
app.get('/dropdown-search', (req, res) => {
  const { keyword } = req.query;

  if (!keyword) {
    return res.status(400).send('Keyword is required');
  }

  const formattedKeyword = `%${keyword}%`;
  const query =
    'select property_city, property_state, property_zip, count(property.id_property) as prop_count from property where (property.property_zip like ? or property.property_city like ?) and 1=1 group by property.property_city order by prop_count desc LIMIT 7';

  db.query(query, [formattedKeyword, formattedKeyword], (err, results) => {
    if (err) {
      console.error('Error in database query:', err);
      return res.status(500).send('Internal Server Error');
    }
    res.json(results);
  });
});

// Endpoint for propertySearch
app.get('/property-search', (req, res) => {
  const { city, state, zip } = req.query;

  if (!city && !state && !zip) {
    return res.status(400).json({
      status: 'Error',
      data: 'At least one search parameter is required',
    });
  }

  let query =
    'SELECT MAX(lat) AS NELatitude, MAX(lng) AS NELongitude, MIN(lat) AS SWLatitude, MIN(lng) AS SWLongitude FROM property WHERE';
  const conditions = [];
  const params = [];

  if (city) {
    conditions.push(' property_city = ?');
    params.push(city);
  }

  if (state) {
    conditions.push(' property_state = ?');
    params.push(state);
  }

  if (zip) {
    conditions.push(' property_zip = ?');
    params.push(zip);
  }

  query += conditions.join(' AND ');
  // console.log(query);
  db.query(query, params, async (err, results) => {
    if (err) {
      console.error('Error in database query:', err);
      return res
        .status(500)
        .json({ status: 'Error', data: 'Internal Server Error' });
    }
    if (results.length > 0 && results[0].NELatitude != null) {
      // Call to third-party API
      const boundingBox = results[0];
      // Start constructing the third-party API URL with bounding box coordinates
    let apiUrl = `https://staging-api.propmix.io/pubrec/distress/v1/GetPropertiesInBoundingBox?NELatitude=${boundingBox.NELatitude}&NELongitude=${boundingBox.NELongitude}&SWLatitude=${boundingBox.SWLatitude}&SWLongitude=${boundingBox.SWLongitude}`;

     // Add pagination parameters
     const { PageNumber = 1, PageSize = 10, ...filters } = req.query;
     apiUrl += `&PageNumber=${PageNumber}&PageSize=${PageSize}`;

     //hardcoded some param 
     apiUrl += `&DistressStatus=Auction&AbbreviatedFieldNames=0&StandardStatus=Active`;

     // Dynamically add any filter parameters from the request query
    Object.keys(filters).forEach(key => {
      apiUrl += `&${key}=${encodeURIComponent(filters[key])}`;
    });


      const apiHeaders = {
        AccessToken:
          '4b7ad7f1733fa22d5c7cb7f0b1ff59698fa19fe61987034c6ee5443cde557e4a',
      };

      try {
        const response = await fetch(apiUrl, { headers: apiHeaders });
        const apiData = await response.json();
        res.json(apiData);
      } catch (apiErr) {
        console.error('Error calling third-party API:', apiErr);
        res.status(500).json({
          status: 'Error',
          data: 'Error fetching data from third-party API',
        });
      }
    } else {
      res.json({
        status: 'Success',
        data: 'No matching properties found or insufficient data to calculate bounding box',
      });
    }
  });
}); // end property search


//Enquiry end point start
const auth = new google.auth.GoogleAuth({
  keyFile: 'homeauctiondeals-ec31743fd08f.json', // Path to your service account credentials
  scopes: 'https://www.googleapis.com/auth/spreadsheets',
});

const spreadsheetId = '1jILjxhljcX0s5Y1_gpHmx4DHC3NhbSxoYey_5A3bG3k'; // The ID of your Google Sheet

app.post('/enquiry', async (req, res) => {
 
  const { fullName, phone, email, description = '', notification = false } = req.body;

  // Validate mandatory fields
  if (!fullName || !phone || !email) {
      return res.status(400).send({ message: 'Missing mandatory fields' });
  }

  const sheets = google.sheets({ version: 'v4', auth });

  try {
      await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'Sheet1', // Adjust based on your sheet name
          valueInputOption: 'USER_ENTERED',
          requestBody: {
              values: [[fullName, phone, email, description, notification]],
          },
      });

      res.send({ status: 'Success',
      data: 'Data successfully saved' });
  } catch (error) {
      console.error('Failed to save enquiry:', error);
      res.status(500).send({ message: 'Failed to save enquiry' });
  }
});
//End enquiry endpoint

// Server setup
const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
