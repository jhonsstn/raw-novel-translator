import { NovelClient } from '../../../components/novel-client';
export default async function NovelPage({params}:{params:Promise<{novelId:string}>}){const {novelId}=await params;return <main><NovelClient novelId={novelId}/></main>;}
