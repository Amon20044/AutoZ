import EditorPage from '../page'

export default function EditorProjectPage({ params }) {
  return <EditorPage initialPublishId={params.slug} />
}
