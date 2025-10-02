// app/ForgotPasswordScreen.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import ApiService from '../services/api';

// Add navigation prop type
interface ForgotPasswordScreenProps {
  navigation: any;
}

const ForgotPasswordScreen: React.FC<ForgotPasswordScreenProps> = ({ navigation }) => {
  const [step, setStep] = useState<'verify' | 'otp' | 'newPassword'>('verify');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendOtp = async () => {
    if (!email || !phoneNumber) {
      Alert.alert('Error', 'Please enter both email and phone number');
      return;
    }

    if (!validateEmail(email)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    setLoading(true);
    try {
      await ApiService.sendPasswordResetOtp(email, phoneNumber);
      Alert.alert('Success', 'OTP sent to your email');
      setStep('otp');
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.error || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp || otp.length !== 6) {
      Alert.alert('Error', 'Please enter a valid 6-digit OTP');
      return;
    }

    setLoading(true);
    try {
      await ApiService.verifyPasswordResetOtp(email, phoneNumber, otp);
      Alert.alert('Success', 'OTP verified successfully');
      setStep('newPassword');
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.error || 'Invalid OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword || !confirmPassword) {
      Alert.alert('Error', 'Please enter and confirm your new password');
      return;
    }

    if (newPassword.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await ApiService.resetPassword(email, phoneNumber, otp, newPassword);
      Alert.alert('Success', 'Password reset successfully!', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.error || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  const validateEmail = (email: string) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
          <Text style={styles.title}>Reset Password</Text>
          
          {step === 'verify' && (
            <View style={styles.stepContainer}>
              <Text style={styles.subtitle}>Verify Your Identity</Text>
              <Text style={styles.description}>
                Enter your email and phone number to receive a verification code
              </Text>
              
              <TextInput
                style={styles.input}
                placeholder="Email Address *"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
              
              <TextInput
                style={styles.input}
                placeholder="Phone Number *"
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                keyboardType="phone-pad"
                autoComplete="tel"
              />
              
              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleSendOtp}
                disabled={loading}
              >
                <Text style={styles.buttonText}>
                  {loading ? 'Sending...' : 'Send Verification Code'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 'otp' && (
            <View style={styles.stepContainer}>
              <Text style={styles.subtitle}>Enter Verification Code</Text>
              <Text style={styles.description}>
                We've sent a 6-digit code to your email: {email}
              </Text>
              
              <TextInput
                style={styles.input}
                placeholder="Enter 6-digit OTP *"
                value={otp}
                onChangeText={setOtp}
                keyboardType="number-pad"
                maxLength={6}
              />
              
              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleVerifyOtp}
                disabled={loading}
              >
                <Text style={styles.buttonText}>
                  {loading ? 'Verifying...' : 'Verify Code'}
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.resendButton}
                onPress={handleSendOtp}
                disabled={loading}
              >
                <Text style={styles.resendText}>Resend Code</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 'newPassword' && (
            <View style={styles.stepContainer}>
              <Text style={styles.subtitle}>Create New Password</Text>
              <Text style={styles.description}>
                Enter your new password below
              </Text>
              
              <TextInput
                style={styles.input}
                placeholder="New Password *"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                autoComplete="password-new"
              />
              
              <TextInput
                style={styles.input}
                placeholder="Confirm New Password *"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                autoComplete="password-new"
              />
              
              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleResetPassword}
                disabled={loading}
              >
                <Text style={styles.buttonText}>
                  {loading ? 'Resetting...' : 'Reset Password'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    padding: 20,
    paddingTop: 60,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: 30,
  },
  stepContainer: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 15,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 15,
    backgroundColor: '#fff',
  },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 15,
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  resendButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  resendText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '500',
  },
});

export default ForgotPasswordScreen;