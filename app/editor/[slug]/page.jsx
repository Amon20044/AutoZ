import EditorPage from '../page'

export default async function EditorProjectPage({ params }) {
  const { slug } = await params

  return <EditorPage initialPublishId={slug} />
}
