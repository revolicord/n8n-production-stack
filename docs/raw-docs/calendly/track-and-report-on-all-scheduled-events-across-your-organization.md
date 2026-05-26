# Track and report on all scheduled events across your organization

Avoid pivots in your business plan when you analyze and report on your teams' scheduled events

Calendly owners and admins can report on scheduled events of teams across their organization when they generate and use a personal access token to authenticate requests they make to Calendly's API. There are two ways to report on scheduled events:

1. Make POST requests to the Calendly API to receive basic event and invitee data in real time via a webhook subscription. This method is suggested because after the webhook subscription is created, there is no further input required.

2. Make periodic GET requests to the Calendly API from your system to retrieve current event information to update your system with data from scheduled events.

The information received via either method will include UTM parameters, which help track the source of the booking. To learn more about using UTM parameters, see guide [how to track conversions](https://help.calendly.com/hc/en-us/articles/1500005575121) in our Help Center.
