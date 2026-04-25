/**
 * Canonical list of device type labels the user can pick from the
 * DeviceMetaEditor dropdown. Split into its own module so the React
 * component file only exports a component (keeps Fast Refresh happy).
 */
export const DEVICE_TYPE_OPTIONS = [
    { value: '', label: 'Auto-detect' },
    { value: 'Router / AP', label: 'Router / Access Point' },
    { value: 'Network Device', label: 'Network Device' },
    { value: 'Computer', label: 'Computer' },
    { value: 'Gaming PC', label: 'Gaming PC' },
    { value: 'Phone', label: 'Phone' },
    { value: 'Tablet', label: 'Tablet' },
    { value: 'Apple Device', label: 'Apple Device' },
    { value: 'Samsung Device', label: 'Samsung Device' },
    { value: 'Smart TV', label: 'Smart TV' },
    { value: 'Streaming Stick', label: 'Streaming Stick' },
    { value: 'Game Console', label: 'Game Console' },
    { value: 'Printer', label: 'Printer' },
    { value: 'NAS', label: 'NAS / Storage' },
    { value: 'Server', label: 'Server' },
    { value: 'IP Camera', label: 'IP Camera' },
    { value: 'Smart Camera', label: 'Smart Camera' },
    { value: 'Speaker', label: 'Smart Speaker' },
    { value: 'Smart Light', label: 'Smart Light' },
    { value: 'Smart Plug', label: 'Smart Plug' },
    { value: 'Smart Thermostat', label: 'Smart Thermostat' },
    { value: 'Smart Appliance', label: 'Smart Appliance' },
    { value: 'Wearable', label: 'Wearable' },
    { value: 'IoT / ESP Board', label: 'IoT / Dev Board' },
    { value: 'Virtual Machine', label: 'Virtual Machine' },
    { value: 'Firewall', label: 'Firewall' },
    { value: 'Randomized MAC', label: 'Randomized MAC' },
    { value: 'Unknown', label: 'Unknown' },
]
