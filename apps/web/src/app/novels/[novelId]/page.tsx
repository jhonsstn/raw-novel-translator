import { NovelClient } from '../../../components/novel-client';
export default async function NovelPage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  return (
    <main className="mx-auto w-full max-w-[1304px] px-8 pt-[52px] pb-20 max-[960px]:px-5 max-[760px]:px-3.5 max-[760px]:pt-8 max-[760px]:pb-[60px]">
      <NovelClient novelId={novelId} />
    </main>
  );
}
