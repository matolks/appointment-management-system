# Appointment Manager

Appointment Manager is a desktop application for filling new appointment openings with eligible patients from a waitlist.

## Calendar

Providers are displayed on the left, and their openings are displayed on the calendar in the center. Clicking an opening shows eligible waitlist patients who can fill that appointment time.

### Features

- Clear/reset the database
- Import and export data using Excel sheets
- Add new openings
- Edit or remove current openings
- Add, edit, or remove providers
- Automatically purge openings 14 days after they have passed

## Waitlist

The waitlist displays all current patients waiting for an appointment. Separate views are available for scheduled patients and removed patients, for tracking purposes.

### Features

- Sort patients by date added, name, provider, or tier
- Add, edit, or remove patients from the waitlist
- View scheduled patients
- View removed patients
- Track patient status across waitlisted, scheduled, and removed sections

## Tech Stack

- React
- TypeScript
- Electron
- SQLite
- Excel import/export with SheetJS
- CSS

## Future Improvements

- Send automated text messages when scheduling a patient
- Support for military time if needed
- Improve scheduling notifications and reminders
