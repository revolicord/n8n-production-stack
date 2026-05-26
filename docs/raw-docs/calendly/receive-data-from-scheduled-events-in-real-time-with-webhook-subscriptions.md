# Receive Data from Scheduled Events in Real Time with Webhook Subscriptions

When you [create a webhook subscription](https://developer.calendly.com/api-docs/b3A6NTkxNDI1-create-webhook-subscription), payloads will be sent in real time to your server endpoint when events are scheduled or canceled by either the host or the invitee. When you create a webhook subscription, you can subscribe to either or both:

- `invitee.created` for only data about scheduled events by invitees
- `invitee.canceled` for only data about canceled events by invitees
- `routing_form_submission.created` for only data about routing form submissions

Subscribing to both `invitee.created` and `invitee.canceled` events will return all scheduled and canceled events across all team members in your organization with a single subscription giving you full transparency into the success of meetings.

Subscribing to the `routing_form_submission.created` event will fire anytime someone submits a routing form, whether they book or not. **NOTE:** The only allowed subscription scope for Routing form submissions is `organization`.

## Authentication Scopes

If you're an owner or admin, the personal access token you generate will authenticate the POST request with:

- the `user` scope if you want to return a response payload for data about all scheduled events for yourself
- the `organization` scope if you want to return a response payload for data about all scheduled events for your organization

If you're a team member and not an owner of admin of a Calendly organization, the personal access token you generate will only authenticate the POST request with the `user` scope to return a response payload for data about your own scheduled events.

## To Create a Webhook Subscription

Before you create a webhook subscription, ensure that you have the `organization` or the `user` URI (see [how to find the organization or user uri](https://developer.calendly.com/how-to-find-the-organization-or-user-uri)) depending on which events you want to scope for.

1. Make a POST request to the `/webhook_subscriptions` [endpoint](https://developer.calendly.com/api-docs/b3A6NTkxNDI1-create-webhook-subscription).
2. Add your personal access token to authenticate the request.
3. Set your server endpoint in the `url` value.
4. Set `invitee.created,` or `invitee.canceled,` or `routing_form_submission.created` (or all 3) for the `events` value
5. Choose the `user` or `organization` value to isolate scheduled events to yourself or the organization.
   - **Example request:**
     ```bash
     curl --request POST --url https://api.calendly.com/webhook_subscriptions \
       --header 'Content-Type: application/json' \
       --header 'authorization: Bearer <your personal access token>' \
       --data '{
         "url":"http://yourserverendpoint.com",
         "events":["invitee.created", "invitee.canceled"],
         "organization":"https://api.calendly.com/organizations/AAAAAAAAAAAAAAAA",
         "scope":"organization"
       }'
     ```
6. (Optional) To get data about an invitee such as name, email, and their answers to custom questions on an event booking page, use the URI property in the webhook payload to make a GET request to the `/scheduled_events/{event_uuid}/invitees/{invitee_uuid}` [endpoint](https://developer.calendly.com/api-docs/b3A6NTkxNDE1-get-event-invitee).

## Matching Invitees and Tracking Cancellations

When an invitee cancels an event, you can match them to an existing invitee in your system by comparing the URI. This will allow you to exclude the invitee or event from your data, or specifically track canceled or rescheduled events.
