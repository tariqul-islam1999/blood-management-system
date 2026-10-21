
import { useState } from 'react';

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

// ========== TYPES ==========

type FormField =
  | 'profileImage'
  | 'name'
  | 'email'
  | 'phone'
  | 'password'
  | 'confirmPassword'
  | 'district'
  | 'thana'
  | 'localArea';

type FormErrors = Partial<Record<FormField, string>>;

// ========== CONSTANTS ==========

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,}$/;

// ========== MAIN COMPONENT ==========

export default function BeneficiaryRegisterScreen() {

  // Personal information
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // Passwords
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] =
    useState('');

  const [showPassword, setShowPassword] =
    useState(false);

  const [showConfirmPassword, setShowConfirmPassword] =
    useState(false);

  // Profile picture
  const [profileImage, setProfileImage] =
    useState<string | null>(null);

  // Manual location inputs
  const [district, setDistrict] = useState('');
  const [thana, setThana] = useState('');
  const [localArea, setLocalArea] = useState('');

  // Validation errors
  const [errors, setErrors] = useState<FormErrors>({});

  // ========== CLEAR ERROR ==========

  const clearError = (field: FormField) => {
    setErrors((previous) => ({
      ...previous,
      [field]: undefined,
    }));
  };

  // ========== PROFILE PICTURE ==========

  const pickProfileImage = async () => {
    try {
      const result =
        await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const photo = result.assets[0];

      const allowedTypes = [
        'image/jpeg',
        'image/png',
      ];

      if (
        !photo.mimeType ||
        !allowedTypes.includes(
          photo.mimeType.toLowerCase()
        )
      ) {
        setErrors((previous) => ({
          ...previous,
          profileImage:
            'Please select a JPG or PNG photo.',
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
          profileImage:
            'Photo must be 5 MB or smaller.',
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

  // ========== FORM VALIDATION ==========

  const validateForm = (): boolean => {

    const newErrors: FormErrors = {};

    // Profile picture
    if (!profileImage) {
      newErrors.profileImage =
        'Profile picture is required.';
    }

    // Full name
    const cleanName = name.trim();

    if (!cleanName) {
      newErrors.name = 'Full name is required.';
    } else if (cleanName.length < 2) {
      newErrors.name =
        'Enter at least 2 characters.';
    }

    // Email
    const cleanEmail = email.trim();

    if (!cleanEmail) {
      newErrors.email = 'Email is required.';
    } else if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
    ) {
      newErrors.email =
        'Enter a valid email address.';
    }

    // Password
    if (!password) {
      newErrors.password =
        'Password is required.';
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
    } else if (
      password !== confirmPassword
    ) {
      newErrors.confirmPassword =
        'Passwords do not match.';
    }

    // Phone number
    const cleanPhone = phone.trim();

    if (!cleanPhone) {
      newErrors.phone =
        'Phone number is required.';
    } else if (
      !/^01[3-9]\d{8}$/.test(cleanPhone)
    ) {
      newErrors.phone =
        'Enter a valid 11-digit Bangladesh mobile number.';
    }

    // Manual location validation
    if (!district.trim()) {
      newErrors.district =
        'District is required.';
    }

    if (!thana.trim()) {
      newErrors.thana =
        'Thana / Upazila is required.';
    }

    if (!localArea.trim()) {
      newErrors.localArea =
        'Local Area is required.';
    }

    setErrors(newErrors);

    return Object.keys(newErrors).length === 0;
  };

  // ========== SUBMIT ==========

  const handleRegister = () => {

    Keyboard.dismiss();

    if (!validateForm()) {
      return;
    }

    Alert.alert(
      'Validation Successful',
      'All beneficiary information is valid. This is a demo form. Supabase registration will be added later.'
    );
  };

  // ========== USER INTERFACE ==========

  return (
    <SafeAreaView
      style={styles.container}
      edges={['bottom']}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >

        {/* TITLE */}

        <Text style={styles.title}>
          Beneficiary Registration
        </Text>

        <Text style={styles.subtitle}>
          Create an account to find blood donors.
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
                <Text style={styles.cameraIcon}>
                  📷
                </Text>

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

        <Text style={styles.label}>
          Full Name *
        </Text>

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

        <Text style={styles.label}>
          Email Address *
        </Text>

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

        <Text style={styles.label}>
          Password *
        </Text>

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
            style={styles.visibilityButton}
            onPress={() =>
              setShowPassword(!showPassword)
            }
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
            errors.confirmPassword &&
              styles.inputError,
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
            style={styles.visibilityButton}
            onPress={() =>
              setShowConfirmPassword(
                !showConfirmPassword
              )
            }
          >
            <Text style={styles.visibilityText}>
              {showConfirmPassword
                ? 'Hide'
                : 'Show'}
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

        {/* MANUAL LOCATION */}

        <Text style={styles.sectionTitle}>
          Your Location
        </Text>

        <Text style={styles.sectionSubtitle}>
          Enter your location in English.
          Follow the example formats below.
        </Text>

        {/* DISTRICT */}

        <Text style={styles.label}>
          District *
        </Text>

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

        {/* THANA */}

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

        <Text style={styles.label}>
          Local Area *
        </Text>

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

        {/* SUBMIT BUTTON */}

        <Pressable
          style={styles.registerButton}
          onPress={handleRegister}
        >
          <Text style={styles.registerText}>
            Validate Beneficiary Form
          </Text>
        </Pressable>

        {/* DEMO NOTICE */}

        <Text style={styles.note}>
          This is a demo form.
          No real account is created yet.
          Supabase authentication will be added later.
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
