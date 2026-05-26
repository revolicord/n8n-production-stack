# Trigger Automation with Other Apps When Invitees Schedule, Cancel, or Reschedule Events

Our webhook subscription will inform you when invitees book, cancel, or reschedule events. While the process is completely manual, you can use the values within the webhook payload to trigger follow up actions in the internal or custom-built apps you or your team use.

If you want to trigger automations without any development work, learn more about our integration with Zapier, which connects Calendly to apps you use daily.

## When Webhooks Are Triggered

- **When an event is scheduled**: the `invitee.created` webhook is triggered.
- **When an event is canceled**: the `invitee.canceled` webhook is triggered.
- **When an event is rescheduled**: both the `invitee.created` and `invitee.canceled` webhooks are triggered.

To learn more about creating a webhook subscription, see [receive scheduled event data in real time with webhook subscriptions](#).

## Webhook Payload Values

To create your own follow up actions, use the values located within the webhook payload. Some that may be helpful include:

### The event Value

The event value identifies which payload was triggered as a result of the meeting being scheduled or canceled:

- `"event": "invitee.created"` is triggered when an event is scheduled
- `"event": "invitee.canceled"` is triggered when an event is canceled

### The status Value

The status value identifies if the invitee is attending or not attending the scheduled event:

- `"status": "active"` indicates that the invitee will attend the scheduled event
- `"status": "canceled"` indicates that the invitee will not attend the scheduled event

### The canceled Value

The canceled value identifies if the event was canceled:

- `"canceled": false` indicates that the event has not been canceled
- `"canceled": true` indicates that the event has been canceled

The `canceled_by` value identifies who, either the Calendly user or invitee, canceled the meeting.

The `reason` value (if provided by the canceler) lists the textual response the canceler entered when canceling the event.

### The rescheduled Value

The rescheduled value identifies if the event has been rescheduled:

- `"rescheduled": true` indicates the event has been rescheduled
- `"rescheduled": false` indicates the event has not been rescheduled

## Working with Webhooks to Analyze Data or Trigger Automation

Put your data to work when you use these guides to receive, understand, and report on Calendly data when it arrives at an endpoint you specify:

- How to track and report on all scheduled events across your organization
- How to receive data from scheduled events in real-time with webhook subscriptions
- How to understand webhook payloads when invitees reschedule events
