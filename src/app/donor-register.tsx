
import { useState } from 'react';
import { supabase } from '../lib/supabase';

import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Image,
  Keyboard,
  Alert,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import * as ImagePicker from 'expo-image-picker';

import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';

// ========== TYPES ==========

type DateField = 'dob' | 'lastDonation';

type FormField =
  | 'profileImage'
  | 'name'
  | 'email'
  | 'phone'
  | 'password'
  | 'confirmPassword'
  | 'dob'
  | 'bloodGroup'
  | 'lastDonation'
  | 'district'
  | 'thana'
  | 'localArea';

type FormErrors = Partial<Record<FormField, string>>;

// ========== CONSTANTS ==========

const BLOOD_GROUPS = [
  'A+', 'A-', 'B+', 'B-',
  'AB+', 'AB-', 'O+', 'O-',
];

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,}$/;

// ========== HELPER FUNCTIONS ==========

function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
}

function toDatabaseDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function calculateAge(birthDate: Date): number {
  const today = new Date();

  let age = today.getFullYear() - birthDate.getFullYear();

  const birthdayPassed =
    today.getMonth() > birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() &&
      today.getDate() >= birthDate.getDate());

  if (!birthdayPassed) {
    age--;
  }

  return age;
}

function isFutureDate(date: Date): boolean {
  const selected = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );

  const now = new Date();

  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  return selected.getTime() > today.getTime();
}

// ========== MAIN COMPONENT ==========

export default function DonorRegisterScreen() {

  // Personal information
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // Passwords
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] =
    useState(false);

  // Donor information
  const [bloodGroup, setBloodGroup] = useState('');
  const [dob, setDob] = useState<Date | null>(null);

  const [lastDonation, setLastDonation] =
    useState<Date | null>(null);

  // Profile picture
  const [profileImage, setProfileImage] =
    useState<string | null>(null);

  // Manual location information
  const [district, setDistrict] = useState('');
  const [thana, setThana] = useState('');
  const [localArea, setLocalArea] = useState('');

  // Calendar state
  const [activeDateField, setActiveDateField] =
    useState<DateField | null>(null);

  // Validation errors
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  // ========== ERROR HANDLING ==========

  const clearError = (field: FormField) => {
    setErrors((previous) => ({
      ...previous,
      [field]: undefined,
    }));
  };

  // ========== PROFILE PICTURE ==========

  const pickProfileImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const photo = result.assets[0];

      const validMimeTypes = ['image/jpeg', 'image/png'];

      if (
        !photo.mimeType ||
        !validMimeTypes.includes(photo.mimeType.toLowerCase())
      ) {
        setErrors((previous) => ({
          ...previous,
          profileImage: 'Please select a JPG or PNG photo.',
        }));
        return;
      }

      if (photo.fileSize === undefined) {
        setErrors((previous) => ({
          ...previous,
          profileImage:
            'Cannot verify image size. Try another photo.',
        }));
        return;
      }

      if (photo.fileSize > MAX_IMAGE_SIZE) {
        setErrors((previous) => ({
          ...previous,
          profileImage: 'Photo must be 5 MB or smaller.',
        }));
        return;
      }

      setProfileImage(photo.uri);
      clearError('profileImage');

    } catch (error) {
      setErrors((previous) => ({
        ...previous,
        profileImage:
          'Unable to select photo. Please try again.',
      }));
    }
  };

  // ========== CALENDAR ==========

  const openCalendar = (field: DateField) => {
    Keyboard.dismiss();
    setActiveDateField(field);
  };

  const handleDateChange = (
    event: DateTimePickerEvent,
    selectedDate?: Date
  ) => {
    const field = activeDateField;

    setActiveDateField(null);

    if (event.type !== 'set' || !selectedDate) {
      return;
    }

    if (field === 'dob') {
      setDob(selectedDate);
      clearError('dob');
    }

    if (field === 'lastDonation') {
      setLastDonation(selectedDate);
      clearError('lastDonation');
    }
  };

  // ========== VALIDATION ==========

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    // Profile picture
    if (!profileImage) {
      newErrors.profileImage = 'Profile picture is required.';
    }

    // Full name
    const cleanName = name.trim();

    if (!cleanName) {
      newErrors.name = 'Full name is required.';
    } else if (cleanName.length < 2) {
      newErrors.name = 'Enter at least 2 characters.';
    }

    // Email
    const cleanEmail = email.trim();

    if (!cleanEmail) {
      newErrors.email = 'Email is required.';
    } else if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
    ) {
      newErrors.email = 'Enter a valid email address.';
    }

    // Password
    if (!password) {
      newErrors.password = 'Password is required.';
    } else if (
      /\s/.test(password) ||
      !PASSWORD_REGEX.test(password)
    ) {
      newErrors.password =
        'Use 8+ characters with uppercase, lowercase, number and special character. No spaces.';
    }

    // Confirm password
    if (!confirmPassword) {
      newErrors.confirmPassword =
        'Please confirm your password.';
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match.';
    }

    // Bangladesh phone number
    const cleanPhone = phone.trim();

    if (!cleanPhone) {
      newErrors.phone = 'Phone number is required.';
    } else if (!/^01[3-9]\d{8}$/.test(cleanPhone)) {
      newErrors.phone =
        'Enter a valid 11-digit Bangladesh mobile number.';
    }

    // Date of birth
    if (!dob) {
      newErrors.dob = 'Date of birth is required.';
    } else if (isFutureDate(dob)) {
      newErrors.dob = 'DOB cannot be in the future.';
    } else if (calculateAge(dob) < 18) {
      newErrors.dob = 'You must be at least 18 years old.';
    }

    // Blood group
    if (!BLOOD_GROUPS.includes(bloodGroup)) {
      newErrors.bloodGroup = 'Select your blood group.';
    }

    // Manual location validation
    if (!district.trim()) {
      newErrors.district = 'District is required.';
    }

    if (!thana.trim()) {
      newErrors.thana = 'Thana / Upazila is required.';
    }

    if (!localArea.trim()) {
      newErrors.localArea = 'Local Area is required.';
    }

    // Last donation date
    if (lastDonation && isFutureDate(lastDonation)) {
      newErrors.lastDonation =
        'Last donation date cannot be in the future.';
    }

    setErrors(newErrors);

    return Object.keys(newErrors).length === 0;
  };

  // ========== FORM SUBMISSION ==========

  const handleRegister = async () => {
    if (submitting) return;
    Keyboard.dismiss();

    if (!validateForm() || !dob) return;

    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            role: 'donor',
            full_name: name.trim(),
            phone: phone.trim(),
            district: district.trim(),
            thana: thana.trim(),
            local_area: localArea.trim(),
            blood_group: bloodGroup,
            date_of_birth: toDatabaseDate(dob),
            last_donation_date: lastDonation
              ? toDatabaseDate(lastDonation)
              : null,
          },
        },
      });

      if (error) {
        Alert.alert('Registration Failed', error.message);
        return;
      }

      if (!data.user) {
        Alert.alert('Registration Status', 'No user was returned. Please check your email and contact support if needed.');
        return;
      }

      // Supabase may obscure duplicate email signups when confirmation is enabled.
      // A successful response alone does not prove a new account was created.
      Alert.alert(
        'Check Your Email',
        'If this email is eligible for registration, follow the verification email instructions. Your profile photo has NOT been uploaded yet; that will be added after secure Storage setup.'
      );
    } catch (err) {
      Alert.alert(
        'Registration Error',
        err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ========== SCREEN UI ==========

  return (
    <SafeAreaView
      style={styles.container}
      edges={['bottom']}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >

        {/* SCREEN TITLE */}

        <Text style={styles.title}>
          Become a Donor
        </Text>

        <Text style={styles.subtitle}>
          Register to help save lives
        </Text>

        {/* PROFILE PICTURE */}

        <View style={styles.photoContainer}>

          <Pressable onPress={pickProfileImage}>
            {profileImage ? (
              <Image
                source={{ uri: profileImage }}
                style={styles.profilePhoto}
              />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Text style={styles.cameraIcon}>📷</Text>
                <Text style={styles.photoPlaceholderText}>
                  Add Photo
                </Text>
              </View>
            )}
          </Pressable>

          <Pressable onPress={pickProfileImage}>
            <Text style={styles.uploadText}>
              {profileImage
                ? 'Change Profile Photo'
                : 'Upload Profile Photo *'}
            </Text>
          </Pressable>

          <Text style={styles.photoHint}>
            JPG / PNG - Maximum 5 MB
          </Text>

          {errors.profileImage && (
            <Text style={styles.errorText}>
              {errors.profileImage}
            </Text>
          )}
        </View>

        {/* FULL NAME */}

        <Text style={styles.label}>Full Name *</Text>

        <TextInput
          style={[
            styles.input,
            errors.name && styles.inputError,
          ]}
          placeholder="Enter your full name"
          value={name}
          onChangeText={(value) => {
            setName(value);
            clearError('name');
          }}
        />

        {errors.name && (
          <Text style={styles.errorText}>
            {errors.name}
          </Text>
        )}

        {/* EMAIL */}

        <Text style={styles.label}>Email Address *</Text>

        <TextInput
          style={[
            styles.input,
            errors.email && styles.inputError,
          ]}
          placeholder="example@gmail.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            clearError('email');
          }}
        />

        {errors.email && (
          <Text style={styles.errorText}>
            {errors.email}
          </Text>
        )}

        {/* PASSWORD */}

        <Text style={styles.label}>Password *</Text>

        <View
          style={[
            styles.passwordContainer,
            errors.password && styles.inputError,
          ]}
        >
          <TextInput
            style={styles.passwordInput}
            placeholder="Create a strong password"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              clearError('password');
              clearError('confirmPassword');
            }}
          />

          <Pressable
            onPress={() => setShowPassword(!showPassword)}
            style={styles.visibilityButton}
          >
            <Text style={styles.visibilityText}>
              {showPassword ? 'Hide' : 'Show'}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.hint}>
          8+ characters, uppercase, lowercase,
          number and special character.
        </Text>

        {errors.password && (
          <Text style={styles.errorText}>
            {errors.password}
          </Text>
        )}

        {/* CONFIRM PASSWORD */}

        <Text style={styles.label}>
          Confirm Password *
        </Text>

        <View
          style={[
            styles.passwordContainer,
            errors.confirmPassword && styles.inputError,
          ]}
        >
          <TextInput
            style={styles.passwordInput}
            placeholder="Re-enter your password"
            secureTextEntry={!showConfirmPassword}
            autoCapitalize="none"
            autoCorrect={false}
            value={confirmPassword}
            onChangeText={(value) => {
              setConfirmPassword(value);
              clearError('confirmPassword');
            }}
          />

          <Pressable
            onPress={() =>
              setShowConfirmPassword(!showConfirmPassword)
            }
            style={styles.visibilityButton}
          >
            <Text style={styles.visibilityText}>
              {showConfirmPassword ? 'Hide' : 'Show'}
            </Text>
          </Pressable>
        </View>

        {errors.confirmPassword && (
          <Text style={styles.errorText}>
            {errors.confirmPassword}
          </Text>
        )}

        {/* PHONE NUMBER */}

        <Text style={styles.label}>
          Phone Number *
        </Text>

        <TextInput
          style={[
            styles.input,
            errors.phone && styles.inputError,
          ]}
          placeholder="017XXXXXXXX"
          keyboardType="phone-pad"
          maxLength={11}
          value={phone}
          onChangeText={(value) => {
            setPhone(value);
            clearError('phone');
          }}
        />

        {errors.phone && (
          <Text style={styles.errorText}>
            {errors.phone}
          </Text>
        )}

        {/* DATE OF BIRTH */}

        <Text style={styles.label}>
          Date of Birth *
        </Text>

        <Pressable
          style={[
            styles.dateInput,
            errors.dob && styles.inputError,
          ]}
          onPress={() => openCalendar('dob')}
        >
          <Text
            style={[
              styles.dateText,
              !dob && styles.placeholder,
            ]}
          >
            {dob
              ? formatDate(dob)
              : 'Select Date of Birth'}
          </Text>

          <Text style={styles.calendarIcon}>📅</Text>
        </Pressable>

        {dob && (
          <Text style={styles.hint}>
            Age: {calculateAge(dob)} years
          </Text>
        )}

        {errors.dob && (
          <Text style={styles.errorText}>
            {errors.dob}
          </Text>
        )}

        {/* BLOOD GROUP */}

        <Text style={styles.label}>
          Blood Group *
        </Text>

        <View style={styles.bloodGroupContainer}>
          {BLOOD_GROUPS.map((group) => (
            <Pressable
              key={group}
              onPress={() => {
                setBloodGroup(group);
                clearError('bloodGroup');
              }}
              style={[
                styles.bloodGroupButton,
                bloodGroup === group &&
                  styles.selectedGroup,
              ]}
            >
              <Text
                style={[
                  styles.groupText,
                  bloodGroup === group &&
                    styles.selectedGroupText,
                ]}
              >
                {group}
              </Text>
            </Pressable>
          ))}
        </View>

        {errors.bloodGroup && (
          <Text style={styles.errorText}>
            {errors.bloodGroup}
          </Text>
        )}

        {/* MANUAL LOCATION SECTION */}

        <Text style={styles.sectionTitle}>
          Your Location
        </Text>

        <Text style={styles.sectionSubtitle}>
          Enter your location in English.
          Follow the example formats below.
        </Text>

        {/* DISTRICT */}

        <Text style={styles.label}>District *</Text>

        <TextInput
          style={[
            styles.input,
            errors.district && styles.inputError,
          ]}
          placeholder="e.g. Dhaka"
          autoCapitalize="words"
          value={district}
          onChangeText={(value) => {
            setDistrict(value);
            clearError('district');
          }}
        />

        {errors.district && (
          <Text style={styles.errorText}>
            {errors.district}
          </Text>
        )}

        {/* THANA / UPAZILA */}

        <Text style={styles.label}>
          Thana / Upazila *
        </Text>

        <TextInput
          style={[
            styles.input,
            errors.thana && styles.inputError,
          ]}
          placeholder="e.g. Mirpur"
          autoCapitalize="words"
          value={thana}
          onChangeText={(value) => {
            setThana(value);
            clearError('thana');
          }}
        />

        {errors.thana && (
          <Text style={styles.errorText}>
            {errors.thana}
          </Text>
        )}

        {/* LOCAL AREA */}

        <Text style={styles.label}>Local Area *</Text>

        <TextInput
          style={[
            styles.input,
            errors.localArea && styles.inputError,
          ]}
          placeholder="e.g. Mirpur-10"
          autoCapitalize="words"
          value={localArea}
          onChangeText={(value) => {
            setLocalArea(value);
            clearError('localArea');
          }}
        />

        {errors.localArea && (
          <Text style={styles.errorText}>
            {errors.localArea}
          </Text>
        )}

        {/* LAST DONATION DATE */}

        <Text style={styles.label}>
          Last Donation Date (Optional)
        </Text>

        <Pressable
          style={[
            styles.dateInput,
            errors.lastDonation && styles.inputError,
          ]}
          onPress={() => openCalendar('lastDonation')}
        >
          <Text
            style={[
              styles.dateText,
              !lastDonation && styles.placeholder,
            ]}
          >
            {lastDonation
              ? formatDate(lastDonation)
              : 'Select Last Donation Date'}
          </Text>

          <Text style={styles.calendarIcon}>📅</Text>
        </Pressable>

        {lastDonation && (
          <Pressable
            onPress={() => {
              setLastDonation(null);
              clearError('lastDonation');
            }}
          >
            <Text style={styles.clearText}>
              Clear Last Donation Date
            </Text>
          </Pressable>
        )}

        {errors.lastDonation && (
          <Text style={styles.errorText}>
            {errors.lastDonation}
          </Text>
        )}

        {/* DATE PICKER */}

        {activeDateField !== null && (
          <DateTimePicker
            value={
              activeDateField === 'dob'
                ? dob ?? new Date(2000, 0, 1)
                : lastDonation ?? new Date()
            }
            mode="date"
            display="default"
            maximumDate={new Date()}
            onChange={handleDateChange}
          />
        )}

        {/* SUBMIT */}

        <Pressable
          style={[styles.registerButton, submitting && { opacity: 0.6 }]}
          onPress={handleRegister}
          disabled={submitting}
        >
          <Text style={styles.registerText}>
            {submitting ? 'Creating Account...' : 'Create Donor Account'}
          </Text>
        </Pressable>

        <Text style={styles.note}>
          Donor accounts require admin verification.
          Profile photo upload will be enabled after secure Storage setup.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}

// ========== STYLES ==========

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: '#FFF5F5',
  },

  content: {
    padding: 24,
    paddingBottom: 45,
  },

  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#991B1B',
  },

  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    color: '#6B7280',
    marginTop: 8,
    marginBottom: 25,
  },

  photoContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },

  photoPlaceholder: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#FEE2E2',
    borderWidth: 2,
    borderColor: '#DC2626',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },

  profilePhoto: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 2,
    borderColor: '#DC2626',
  },

  cameraIcon: {
    fontSize: 32,
  },

  photoPlaceholderText: {
    fontSize: 12,
    color: '#991B1B',
    marginTop: 5,
  },

  uploadText: {
    color: '#DC2626',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 12,
  },

  photoHint: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 5,
  },

  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333333',
    marginTop: 15,
    marginBottom: 8,
  },

  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: '#111827',
  },

  inputError: {
    borderColor: '#DC2626',
    borderWidth: 1.5,
  },

  errorText: {
    color: '#DC2626',
    fontSize: 12,
    marginTop: 6,
    lineHeight: 18,
  },

  hint: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 6,
    lineHeight: 18,
  },

  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
  },

  passwordInput: {
    flex: 1,
    padding: 14,
    fontSize: 15,
    color: '#111827',
  },

  visibilityButton: {
    padding: 12,
  },

  visibilityText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '600',
  },

  dateInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 14,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  dateText: {
    fontSize: 15,
    color: '#111827',
  },

  placeholder: {
    fontSize: 15,
    color: '#9CA3AF',
  },

  calendarIcon: {
    fontSize: 20,
  },

  clearText: {
    color: '#DC2626',
    fontSize: 13,
    textAlign: 'right',
    marginTop: 8,
  },

  bloodGroupContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },

  bloodGroupButton: {
    width: '22%',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },

  selectedGroup: {
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },

  groupText: {
    color: '#991B1B',
    fontWeight: '600',
  },

  selectedGroupText: {
    color: '#FFFFFF',
  },

  sectionTitle: {
    fontSize: 19,
    fontWeight: 'bold',
    color: '#991B1B',
    marginTop: 28,
  },

  sectionSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 5,
    marginBottom: 8,
  },

  registerButton: {
    backgroundColor: '#DC2626',
    padding: 17,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 35,
  },

  registerText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },

  note: {
    color: '#6B7280',
    textAlign: 'center',
    fontSize: 12,
    marginTop: 15,
    lineHeight: 19,
  },

});
