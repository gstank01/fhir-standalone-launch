// js/patientStore.js

const INITIAL_PATIENTS = [
    {
        id: "RIS-101",
        identifier: "AO13LGR893FNTX9", // Core lookup identifier (MRN / Patient ID)
        name: "Allison Mychart",
        given: "Allison",
        family: "Mychart",
        gender: "Female",
        telecom: "608-123-4567",
        address: {
            street: "123 Main St.",
            city: "Madison",
            state: "Wisconsin",
            postalCode: "53703"
        },
        modality: "CT Scan",
        studyStatus: "Scheduled",
        localNotes: "Pre-op CT scan. Verified patient identifier 123445."
    }
];

const PatientStore = {
    init: function() {
        if (!localStorage.getItem('ris_patients')) {
            localStorage.setItem('ris_patients', JSON.stringify(INITIAL_PATIENTS));
        }
    },

    getAllPatients: function() {
        this.init();
        return JSON.parse(localStorage.getItem('ris_patients')) || [];
    },

    getActivePatientId: function() {
        return sessionStorage.getItem('ris_active_patient_id') || "RIS-101";
    },

    setActivePatientId: function(patientId) {
        sessionStorage.setItem('ris_active_patient_id', patientId);
    },

    getActivePatient: function() {
        const activeId = this.getActivePatientId();
        const patients = this.getAllPatients();
        return patients.find(p => p.id === activeId) || patients[0];
    },

    updateLocalNotes: function(patientId, newNotes) {
        const patients = this.getAllPatients();
        const index = patients.findIndex(p => p.id === patientId);
        if (index !== -1) {
            patients[index].localNotes = newNotes;
            localStorage.setItem('ris_patients', JSON.stringify(patients));
        }
    }
};
