import { ReaderClient } from '../../../components/reader-client';

export default async function ReaderPage({ params }: { params: Promise<{ chapterId: string }> }) {
  const { chapterId } = await params;
  return (
    <main>
      <ReaderClient chapterId={chapterId} />
    </main>
  );
}
