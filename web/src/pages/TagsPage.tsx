import TagManager from '../components/TagManager';

export default function TagsPage() {
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Tag Management</h2>
        <p className="text-sm text-gray-500">
          Create and manage tags for organizing kernel emails.
          Tags can be added to emails from search results or thread views.
        </p>
      </div>
      <TagManager />
    </div>
  );
}