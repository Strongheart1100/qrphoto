const params = new URLSearchParams(location.search);
const token = params.get('token');
const photo = document.getElementById('photo');
const preview = document.getElementById('preview');
const fileInfo = document.getElementById('fileInfo');
const uploadBtn = document.getElementById('uploadBtn');
const message = document.getElementById('message');
let selectedFile = null;

if (!token) {
  message.textContent = 'Invalid or missing upload QR code.';
}

photo.addEventListener('change', () => {
  const file = photo.files[0];
  if (!file) return;

  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) {
    message.textContent = 'Only JPG, JPEG, PNG and WEBP are allowed.';
    photo.value = '';
    uploadBtn.classList.add('hidden');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    message.textContent = 'Photo must be 5 MB or smaller.';
    photo.value = '';
    uploadBtn.classList.add('hidden');
    return;
  }

  selectedFile = file;
  preview.src = URL.createObjectURL(file);
  preview.classList.remove('hidden');
  uploadBtn.classList.remove('hidden');
  fileInfo.textContent = `${file.name} • ${(file.size / 1024 / 1024).toFixed(2)} MB`;
  message.textContent = '';
});

uploadBtn.addEventListener('click', async () => {
  if (!selectedFile || !token) return;
  uploadBtn.disabled = true;
  message.textContent = 'Uploading...';

  const formData = new FormData();
  formData.append('photo', selectedFile);

  try {
    const response = await fetch(`/api/upload/${encodeURIComponent(token)}`, {
      method: 'POST',
      body: formData
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Upload failed.');
    message.textContent = 'Photo uploaded successfully. You can close this page.';
    uploadBtn.classList.add('hidden');
  } catch (error) {
    message.textContent = error.message;
    uploadBtn.disabled = false;
  }
});
