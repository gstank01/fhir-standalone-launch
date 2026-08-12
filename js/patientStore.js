// js/patientStore.js

const PATIENT_LIST = [
    {
        id: "RIS-101",
        identifier: "AO1F9JX4ZMWQX6V", // Lookup identifier (MRN / Patient ID)
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
        localNotes: "Pre-op CT scan. Verified patient identifier."
    },
    {
        id: "RIS-102",
        identifier: "AO1J5HL3V8JC4PQ", 
        name: "Mr. Theodore Mychart",
        given: "Theodore",
        family: "Mychart",
        gender: "Male",
        telecom: "+1 608-213-5806",
        address: {
            street: "1 First Ave",
            city: "Madison",
            state: "WI",
            postalCode: "53706-6782"
        },
        modality: "MRI Brain",
        studyStatus: "Scheduled",
        localNotes: "MRI Brain. Verified patient identifier."
    },
    
     //placeholder test patient
     {
        id: "RIS-103",
        identifier: "AO1SXH83648GK9T", //
        name: "William A Transplant",
        given: "William A",
        family: "Transplant",
        gender: "Male",
        telecom: "+1 608-550-4147",
        address: {
            street: "4147 Glacier Trl",
            city: "Madison",
            state: "Wisconsin",
            postalCode: "53711"
        },
        modality: "US Abdomen",
        studyStatus: "Requested",
        localNotes: "Patient to test referrals"
    },

    //placeholder test patient
     {
        id: "RIS-104",
        identifier: "TEST-MRN-002", //
        name: "Test Patient Two",
        given: "Test",
        family: "Patient",
        gender: "Male",
        telecom: "608-555-0199",
        address: {
            street: "456 Oak Rd.",
            city: "Madison",
            state: "Wisconsin",
            postalCode: "53705"
        },
        modality: "MRI Brain",
        studyStatus: "Arrived",
        localNotes: "Placeholder test patient for future pre-population."
    }
];

const PatientStore = {
    init: function() {
        if (!localStorage.getItem('ris_patients')) {
            localStorage.setItem('ris_patients', JSON.stringify(PATIENT_LIST));
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
    },
    resetPatients: function() {
    localStorage.setItem('ris_patients', JSON.stringify(PATIENT_LIST));
    }
    
};
