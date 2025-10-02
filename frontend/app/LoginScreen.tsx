import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  SafeAreaView,
  Animated,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types';
import ApiService from '../services/api';
import StorageService from '../utils/storage';

type LoginScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Login'>;

const LoginScreen: React.FC = () => {
  const navigation = useNavigation<LoginScreenNavigationProp>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollY = useRef(new Animated.Value(0)).current;

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (!email.includes('@')) {
      Alert.alert('Error!', 'Please enter a valid Email Address');
      return;
    }

    setLoading(true);
    try {
      const response = await ApiService.login({ email, password });
      
      // Store auth data
      await StorageService.setAuthToken('dummy-token'); // You'll implement JWT later
      await StorageService.setUserData({
        Id: response.user_id,
        Name: response.name,
        email: email,
        expiry: '', // You can get this from the API response
      });

      // Navigate to main app
      navigation.replace('Main');
    } catch (error: any) {
      Alert.alert('Login Failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  const navigateToSignup = () => {
    navigation.navigate('Signup');
  };

  const navigateToForgotPassword = () => {
    navigation.navigate('ForgotPassword');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: false }
          )}
          scrollEventThrottle={16}
        >
          <Animated.View style={[styles.background, { transform: [{ translateY: scrollY.interpolate({
            inputRange: [0, 200],
            outputRange: [0, -200],
            extrapolate: 'clamp',
          })}]}]}>
            <Text style={styles.title}>SocioMate</Text>
          </Animated.View>
          <Animated.View style={[styles.formContainer, { opacity: scrollY.interpolate({
            inputRange: [0, 100],
            outputRange: [0, 1],
            extrapolate: 'clamp',
          })}]}>
            <View style={styles.form}>
              <Text style={styles.subtitle}>Your Account</Text>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Enter Email</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Enter your email"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Enter Password</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter your password"
                  secureTextEntry
                  autoCapitalize="none"
                />
              </View>

              {/* Forgot Password Link */}
              <TouchableOpacity 
                style={styles.forgotPasswordButton}
                onPress={navigateToForgotPassword}
              >
                <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Login</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.linkButton} onPress={navigateToSignup}>
                <Text style={styles.linkText}>
                  Don't have an account? <Text style={styles.linkTextBold}>Sign up</Text>
                </Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#03021eff', // Dark purple background as per the inferred design
  },
  container: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
  },
  background: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
    height: 600, // Increased height for initial view
  },
  title: {
    fontSize: 45,
    fontFamily: 'Times New Roman', // Consistent with your update
    fontWeight: 'bold',
    color: '#e3d1e3ff', // Light purple for text, matching the design
    textAlign: 'center',
    position: 'absolute',
    top: '55%',
  },
  formContainer: {
    backgroundColor: '#E6E6FA', // Whitish background for form, matching the design
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    marginTop: 20,
    elevation: 5, // Shadow for Android
    shadowColor: '#000', // Shadow for iOS
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  form: {
    width: '100%', 
  },
  subtitle: {
    fontSize: 28,
    fontFamily: 'Times New Roman', // Applied for consistency
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: '#03021eff', // Matches the form text color
  },
  inputContainer: {
    marginBottom: 15,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 5,
    color: '#03021eff', // Matches the form text color
  },
  input: {
    borderWidth: 1,
    borderColor: '#D8BFD8', // Light purple border, matching the design
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  forgotPasswordButton: {
    alignSelf: 'flex-end',
    marginBottom: 20,
  },
  forgotPasswordText: {
    fontSize: 14,
    color: '#03021eff',
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
  button: {
    backgroundColor: '#03021eff', // Matches the safeArea background for consistency
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: '#fff',
    fontSize: 20,
    fontFamily: 'Times New Roman', // Applied for consistency
    fontWeight: '600',
  },
  linkButton: {
    marginTop: 15,
    alignItems: 'center',
  },
  linkText: {
    fontSize: 16,
    fontFamily: 'Times New Roman', // Applied for consistency
    color: '#03021eff', // Matches the form text color
  },
  linkTextBold: {
    color: '#03021eff', // Matches the form text color
    fontWeight: '600',
  },
});

export default LoginScreen;