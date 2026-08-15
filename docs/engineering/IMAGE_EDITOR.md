# Engineering Guide: Modular Image Editor & Cropper Component

CBOP provides a modular, dependency-free React image editor modal (`ImageEditorModal`) that allows users to zoom, drag-and-pan, and crop images. The component outputs a high-resolution cropped PNG Blob, perfect for profile pictures, company logo uploads, digital signature captures, and similar operations.

---

## 1. Component Path & Interface

- **Component File**: [image-editor-modal.tsx](file:///Users/neuxdemorphous/Documents/Projects/CBOP/app/components/image-editor-modal.tsx)

```typescript
interface ImageEditorModalProps {
  isOpen: boolean              // Control visibility of the modal dialog
  onClose: () => void          // Callback fired when the cancel or close button is clicked
  imageSrc: string             // Input image source (Data URL / base64 or public web url)
  onSave: (blob: Blob) => void // Callback returning the cropped high-res PNG Blob
  cropShape?: 'circle' | 'square' // Shape of the visual crop overlay (Default: 'circle')
  title?: string               // Optional title displayed in the header (Default: 'Edit Image')
}
```

---

## 2. Dynamic Alignment Offsets (`getAvatarStyle`)

To resolve framing issues where a subject's face is cropped too high, we maintain a centralized helper mapping to apply vertical rendering offsets:
- **Helper File**: [avatar-position.ts](file:///Users/neuxdemorphous/Documents/Projects/CBOP/app/lib/avatar-position.ts)
- This helper automatically shifts specified user images downward (e.g. Rahul, Nabeelah, Guru) inside circular bounds using `object-position` CSS styles.

---

## 3. Integration Patterns

### A. Profile Picture Upload Flow
We intercept the file picker's selected file, read it as a Data URL, feed it into the editor modal, and upload the resulting cropped Blob:

```typescript
import { useState } from 'react'
import { ImageEditorModal } from '@/app/components/image-editor-modal'

export default function MyComponent() {
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editorImage, setEditorImage] = useState('')

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      setEditorImage(reader.result as string)
      setIsEditorOpen(true)
    }
    reader.readAsDataURL(file)
    e.target.value = '' // Clear so same file can trigger change
  }

  const handleCropSave = async (blob: Blob) => {
    const formData = new FormData()
    formData.append('file', blob, 'cropped-asset.png')

    // Submit to your route (e.g., /api/session/avatar or a new signature endpoint)
    await fetch('/api/upload', { method: 'POST', body: formData })
  }

  return (
    <div>
      <input type="file" onChange={handleFileChange} accept="image/*" />
      
      <ImageEditorModal
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        imageSrc={editorImage}
        onSave={handleCropSave}
        cropShape="circle" // or "square" for logos/signatures
        title="Crop Image"
      />
    </div>
  )
}
```

### B. Future Digital Signature Management
For signature uploads (which require a rectangular or square crop shape):
1. **Set `cropShape="square"`** on the component.
2. In the `onSave` callback, send the resulting Blob to the signature routes:
   - Create a `POST /api/settings/signatures/upload` endpoint in [settings.ts](file:///Users/neuxdemorphous/Documents/Projects/CBOP/api/routes/settings.ts).
   - Write the uploaded signature image to a secure global uploads subfolder (e.g., `uploads/signatures/`).
   - Link the file URL to the `email_signatures` table.
3. Apply standard validation checking (limiting aspect ratio to landscape or keeping it square).
