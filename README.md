# Roll Call App

A mobile application for managing attendance using QR codes and cloud synchronization, built with Ionic Framework.

## Features

- Import attendees from CSV files
- Add attendees manually
- Generate QR codes for attendees
- Scan QR codes to mark attendance
- Manage permissions (camera, storage)
- Cloud synchronization with Firebase

## Technologies Used

- Ionic Framework
- Angular
- Firebase (Firestore)
- Capacitor
- QR Code Generation and Scanning

## Prerequisites

- Node.js 14+
- npm or yarn
- Ionic CLI
- Android Studio (for Android builds)
- Xcode (for iOS builds)
- Firebase account

## Installation

1. Clone this repository:
```bash
git clone https://github.com/yourusername/rollcall-app-ionic.git
cd rollcall-app-ionic
```

2. Install dependencies:
```bash
npm install
```

3. Create a Firebase project and add your web app to it.

4. Update the Firebase configuration in `src/environments/environment.ts` and `src/environments/environment.prod.ts`.

5. Run the app locally:
```bash
ionic serve
```

## Building for Mobile

### Android

```bash
npm run android
npm run android:run
```

### iOS

```bash
npm run ios
npm run ios:run
```

## Project Structure

- `src/app/models` - Data models
- `src/app/services` - Services for data management, permissions, QR code, etc.
- `src/app/home` - Home page with attendee list
- `src/app/attendee-detail` - Attendee detail page for adding/editing attendees
- `src/app/permissions` - Permissions management page
- `src/app/settings` - Settings page

## Usage

1. **Home Page**: View all attendees, filter by present/absent, search, and access main functions.
2. **Scan QR Code**: Scan attendee QR codes to mark them as present.
3. **Import CSV**: Import attendees from a CSV file.
4. **Add Manually**: Add attendees one by one with the form.
5. **Manage Permissions**: Request and check app permissions.
6. **Settings**: Configure app settings, export data, and sync with cloud.

## CSV Format

The app expects CSV files with the following format:
```
name,email,phone,id
John Doe,john@example.com,1234567890,JD001
Jane Smith,jane@example.com,0987654321,JS002
```

The ID field is optional. If not provided, a UUID will be generated.

## License

This project is licensed under the MIT License - see the LICENSE file for details.