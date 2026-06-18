import {
  type BookingReminderRow,
  BookingRemindersEditor,
} from '@/components/settings/BookingRemindersEditor';
import { bookingReminderTemplates, db } from '@/lib/db';
import { getActiveTenant } from '@/lib/tenant';
import { asc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function BookingRemindersPage() {
  const tenant = await getActiveTenant();
  const rows = await db
    .select({
      id: bookingReminderTemplates.id,
      offsetMinutes: bookingReminderTemplates.offsetMinutes,
      kind: bookingReminderTemplates.kind,
      type: bookingReminderTemplates.type,
      textTemplate: bookingReminderTemplates.textTemplate,
      flowNs: bookingReminderTemplates.flowNs,
      description: bookingReminderTemplates.description,
      isActive: bookingReminderTemplates.isActive,
      sortOrder: bookingReminderTemplates.sortOrder,
    })
    .from(bookingReminderTemplates)
    .where(eq(bookingReminderTemplates.tenantId, tenant.id))
    .orderBy(asc(bookingReminderTemplates.sortOrder), asc(bookingReminderTemplates.offsetMinutes));

  return <BookingRemindersEditor tenantId={tenant.id} reminders={rows as BookingReminderRow[]} />;
}
