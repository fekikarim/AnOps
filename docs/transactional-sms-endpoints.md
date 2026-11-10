> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://developers.brevo.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://developers.brevo.com/_mcp/server.

# Send transactional SMS

Transactional SMS is a solution for non-promotional SMS using the recipient's phone number instead of an email address. Use it to send notifications and confirmations, such as for online orders.

## Requirements

Get your

API key

from [your settings (SMTP & API)](https://account.brevo.com/advanced/api).

If you are new to the API, read more about [how the API works](/docs/how-it-works).

\


## Send SMS message to a mobile number

> **STOP code and message type**
>
> If your SMS content includes a stop/opt-out code, the message is **automatically** switched to `marketing` type — you don't need to (and shouldn't) set `type: "marketing"` yourself to handle this. To send as `transactional`, simply don't include a stop code in the content.

This endpoint is `https://api.brevo.com/v3/transactionalSMS/send` with the POST method. You can send either a `content` string directly, or a `templateId` with `params` to fill in a saved template — one of the two is required. A sample cURL request using `content`:

```curl
curl --request POST \
     --url https://api.brevo.com/v3/transactionalSMS/send \
     --header 'accept: application/json' \
     --header 'api-key: YOUR-API-KEY' \
     --header 'content-type: application/json' \
     --data '
{
  "sender": "MyShop",
  "recipient": "33680065433",
  "content": "Enter this code:CAAA08 to validate your account",
  "type": "transactional",
  "tag": "accountValidation",
  "webUrl": "https://webhook.site/100lyyx1",
  "unicodeEnabled": true,
  "organisationPrefix": "MyCompany"
}
'

```

The params are listed below:

| Attribute name     | Datatype                   | Description                                                                                                                                                                                                                                                                                          | Value                                           |
| ------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| sender             | String                     | Name of the sender. The number of characters is limited to 11 for alphanumeric characters and 15 for numeric characters                                                                                                                                                                              | MyShop                                          |
| recipient          | String                     | Mobile number to send SMS with the country code                                                                                                                                                                                                                                                      | 33680005003                                     |
| content            | String                     | Content of the message. Required if `templateId` is not passed, ignored if `templateId` is passed. If more than 160 characters long, will be sent as multiple text messages                                                                                                                          | Enter this code:CCJJG8 to validate your account |
| templateId         | integer                    | Template ID to send SMS with the template. Overrides `content` when provided. Required if `content` is not passed.                                                                                                                                                                                   | 123                                             |
| params             | object                     | Attributes to fill in the template's placeholder variables. Only applicable when `templateId` is used.                                                                                                                                                                                               | `{"FNAME": "Joe", "LNAME": "Doe"}`              |
| type               | String                     | Type of the SMS: `transactional` (default) or `marketing`. Transactional SMS messages are triggered in response to an action such as a sign-up or purchase. A stop code in the content automatically switches the message to `marketing`, regardless of what you pass here.                          | Choice of `transactional` and `marketing`       |
| tag                | String or array of strings | Tag(s) of the message. Either a single string or an array of up to 10 strings.                                                                                                                                                                                                                       | accountValidation                               |
| webUrl             | Url                        | Webhook to call for each event triggered by the message (delivered etc.)                                                                                                                                                                                                                             | `https://webhook.site/173lyyx1`                 |
| unicodeEnabled     | Boolean                    | Format of the message. It indicates whether the content should be treated as unicode or not.                                                                                                                                                                                                         | Boolean true or false                           |
| organisationPrefix | String                     | A recognizable prefix will ensure your audience knows who you are. Recommended by U.S. carriers. This will be added as your Brand Name before the message content. Prefer verifying maximum length of 160 characters including this prefix in message content to avoid multiple sending of same sms. | Brand name like **My Company**                  |

A successful 201 response:

```json
{
  "messageId": 1511882900100020
}
```

A `400` error code indicates a bad request.

## Get your SMS activity aggregated over a period of time

This request uses the endpoint `https://api.brevo.com/v3/transactionalSMS/statistics/aggregatedReport` with the GET method. Sample cURL request:

```curl
curl --request GET \
     --url 'https://api.brevo.com/v3/transactionalSMS/statistics/aggregatedReport?startDate=&endDate=&days=23&tag=' \
     --header 'accept: application/json' \
     --header 'api-key: '
```

Query params:

| Attribute | Datatype | Description                                                                                              | Value      |
| :-------- | :------- | :------------------------------------------------------------------------------------------------------- | :--------- |
| startDate | String   | Mandatory if endDate is used. Starting date (YYYY-MM-DD) of the report                                   | 2024-01-25 |
| endDate   | String   | Mandatory if startDate is used. Ending date (YYYY-MM-DD) of the report                                   | 2024-02-25 |
| days      | int64    | Number of days in the past including today (positive integer). Not compatible with startDate and endDate | 10         |
| tag       | String   | Filter on a tag                                                                                          | tagged     |

A successful response:

```json
{
  "range": "2015-05-22|2017-11-29",
  "requests": 54,
  "delivered": 16,
  "hardBounces": 5,
  "softBounces": 26,
  "blocked": 4,
  "unsubscribed": 10,
  "replied": 8,
  "accepted": 6,
  "rejected": 14
}
```

\


## Get your SMS activity aggregated per day

This request uses the endpoint `https://api.brevo.com/v3/transactionalSMS/statistics/reports` with the GET method. Sample cURL request:

```curl
curl --request GET \
     --url 'https://api.brevo.com/v3/transactionalSMS/statistics/reports?sort=desc' \
     --header 'accept: application/json'
```

Add more query params to the `--url` value. The params are listed below.

| Attribute | Datatype | Description                                                                                                              | Value      |
| :-------- | :------- | :----------------------------------------------------------------------------------------------------------------------- | :--------- |
| startDate | String   | Mandatory if endDate is used. Starting date (YYYY-MM-DD) of the report                                                   | 2024-01-25 |
| endDate   | String   | Mandatory if startDate is used. Ending date (YYYY-MM-DD) of the report                                                   | 2024-02-25 |
| days      | int64    | Number of days in the past including today (positive integer). Not compatible with startDate and endDate                 | 10         |
| tag       | String   | Filter on a tag                                                                                                          | tagged     |
| sort      | String   | Sort the results in the ascending/descending order of record creation. Default order is descending if sort is not passed | desc       |

A successful response:

```json
{
  "reports": [
    {
      "date": "2017-04-30",
      "requests": 10756,
      "delivered": 10103,
      "hardBounces": 21,
      "softBounces": 137,
      "blocked": 1026,
      "unsubscribed": 720,
      "replied": 5091,
      "accepted": 2318,
      "rejected": 0,
      "skipped": 0
    },
    {
      "date": "2017-05-01",
      "requests": 18812,
      "delivered": 17499,
      "hardBounces": 34,
      "softBounces": 254,
      "blocked": 1514,
      "unsubscribed": 1090,
      "replied": 10089,
      "accepted": 4393,
      "rejected": 0,
      "skipped": 0
    },
    {
      "date": "2017-05-02",
      "requests": 14321,
      "delivered": 13427,
      "hardBounces": 16,
      "softBounces": 176,
      "blocked": 1646,
      "unsubscribed": 1170,
      "replied": 11563,
      "accepted": 4689,
      "rejected": 0,
      "skipped": 1
    }
  ]
}
```

## Get all your SMS activity (unaggregated events)

This request uses the endpoint `https://api.brevo.com/v3/transactionalSMS/statistics/events` with the GET method. Sample cURL request:

```curl
curl --request GET \
     --url 'https://api.brevo.com/v3/transactionalSMS/statistics/events?limit=50&offset=0&sort=desc' \
     --header 'accept: application/json'
```

The query params for this endpoint are listed below.

| Attribute   | Datatype | Description                                                                                                              | Value                                                  |
| :---------- | :------- | :----------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------- |
| startDate   | String   | Mandatory if endDate is used. Starting date (YYYY-MM-DD) of the report                                                   | 2024-01-25                                             |
| endDate     | String   | Mandatory if startDate is used. Ending date (YYYY-MM-DD) of the report                                                   | 2024-02-25                                             |
| days        | int64    | Number of days in the past including today (positive integer). Not compatible with startDate and endDate                 | 10                                                     |
| tags        | String   | Filter for specific tags, passed as a serialized urlencoded array                                                        | tagged                                                 |
| sort        | String   | Sort the results in the ascending/descending order of record creation. Default order is descending if sort is not passed | desc                                                   |
| limit       | int64    | Number of documents per page                                                                                             | 50                                                     |
| offset      | integer  | Index of the first document of the page                                                                                  | 2                                                      |
| phoneNumber | String   | Filter the report for a specific phone number                                                                            | 33680005003                                            |
| event       | String   | Filter the report for specific events                                                                                    | Includes events like bounces, delivered, accepted etc. |

A successful response:

```json
{
  "events": [
    {
      "phoneNumber": "00911059469013",
      "date": "2015-05-20T12:30:00Z",
      "messageId": "1473139351170140",
      "event": "sent",
      "reason": "Recipient is currently unreachable",
      "tag": "cabWaiting"
    },
    {
      "phoneNumber": "00911059469013",
      "date": "2015-05-20T16:30:00Z",
      "messageId": "1473139351170140",
      "event": "delivered",
      "reason": "Recipient is currently unreachable",
      "tag": "cabRequest"
    }
  ]
}
```