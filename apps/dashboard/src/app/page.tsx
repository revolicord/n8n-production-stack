import { redirect } from 'next/navigation';

export default function HomePage() {
  const year = new Date().getUTCFullYear();
  redirect(`/year/${year}`);
}
