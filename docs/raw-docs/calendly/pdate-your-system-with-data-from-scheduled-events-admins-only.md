# Update your system with data about scheduled events (admins only)

1. As an owner or admin in your organization, [generate a personal access token](https://developer.calendly.com/how-to-authenticate-with-personal-access-tokens).

2. Before continuing, ensure that you have your organization's URI.

3. To get information about all scheduled events in your organization, including canceled events, make a GET request to the `/scheduled_events` [endpoint](https://developer.calendly.com/api-docs/b3A6NTkxNDEy-list-events).
   
   You will need to provide the organization URI you found in step 2 in the organization parameter, and specify the `active` status to filter out canceled events. Optionally, add date parameters to isolate scheduled events within a range for more recent reporting.
   
   Example request:
   ```
   curl --request GET \
   --url 'https://api.calendly.com/scheduled_events?organization=https://api.calendly.com/organizations/AAAAAAAAAAAAAAAA&status=active' \
   --header 'authorization: Bearer <your personal access token>'
   ```

4. (optional) To get data about all invitees associated with an event such as name, email, and their answers to custom questions on an event booking page, make a GET request to the `/scheduled_events/{event_uuid}/invitees/{invitee_uuid}` [endpoint](https://developer.calendly.com/api-docs/b3A6NTkxNDE1-get-event-invitee).
   
   Example request:
   ```
   curl --request GET \
   --url https://api.calendly.com/scheduled_events/CCCCCCCCCCCCCCCC/invitees \
   --header 'authorization: Bearer <your personal access token>'
   ```

5. When you periodically pull more information from `/scheduled_events`, set the `min_start_time` to the date and time of your last request because event information will not be changed once an event is in the past.

6. To determine whether the event is already included in your report, compare scheduled event URIs. Exclude the `status` parameter so you can exclude/handle any canceled events (by checking the status property of a scheduled event).
