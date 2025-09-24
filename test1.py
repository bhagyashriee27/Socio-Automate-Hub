import json
import requests
import time
import smtplib
import os
from email.mime.text import MIMEText
import gspread
from google.oauth2.service_account import Credentials
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
import pytz
import logging
import yfinance as yf
import pandas as pd
import numpy as np
import uuid

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Set IST timezone
ist = pytz.timezone('Asia/Kolkata')

# Record start time
start_time = time.time()
logger.info("Starting stock report script...")

# Step 1: Execute Google Apps Script macro twice with a 4-second pause
macro_url = "https://script.google.com/macros/s/AKfycbxwqDh0Bktqfz_1xfWeh8BMx8f60pftKfsHKhnN-MF-J5nNJFO1c94KmxjUapc-G_8/exec"
logger.info("Executing first Google Apps Script macro...")
try:
    response = requests.get(macro_url)
    requests.get(macro_url)
    response.raise_for_status()
    logger.info("First Google Apps Script macro executed successfully.")
except Exception as e:
    logger.error(f"Error executing first macro: {e}")

logger.info("Pausing for 4 seconds...")
time.sleep(4)

logger.info("Executing second Google Apps Script macro...")
try:
    response = requests.get(macro_url)
    response.raise_for_status()
    logger.info("Second Google Apps Script macro executed successfully.")
except Exception as e:
    logger.error(f"Error executing second macro: {e}")

# Step 2: Google Sheets authentication
try:
    credentials_info = json.loads(os.environ.get('GOOGLE_CREDENTIALS_JSON'))
    creds = Credentials.from_service_account_info(credentials_info, scopes=[
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
    ])
    client = gspread.authorize(creds)
    logger.info("Google Sheets authentication successful")
except Exception as e:
    logger.error(f"Error loading credentials: {e}")
    exit(1)

# Open the Google Spreadsheet
sheet_id = '1Wed42cXywWty-J7JRmXlKs-61TpnD3nNtcVfpjnIYXQ'
try:
    workbook = client.open_by_key(sheet_id)
    logger.info("Successfully opened Google Spreadsheet")
except Exception as e:
    logger.error(f"Error opening spreadsheet: {e}")
    exit(1)

# Get stock symbols from Sheet1 (Column B, starting from row 4)
try:
    sheet1 = workbook.worksheet('Sheet1')
    stock_symbols = [s for s in sheet1.col_values(2)[3:] if s.strip()]  # Skip empty strings
    logger.info(f"Retrieved {len(stock_symbols)} stock symbols from Sheet1: {stock_symbols[:5]}...")
except Exception as e:
    logger.error(f"Error reading stock symbols from Sheet1: {e}")
    exit(1)

if not stock_symbols:
    logger.error("No stock symbols found in Sheet1, Column B, starting from row 4")
    exit(1)

# Headers for Calculation sheet
headers = [
    "Stock", "NSE Symbol", "Latest Close", "SMA(Close, 200)", "ADX(14)", "Latest Open",
    "Latest Volume", "SMA(Volume, 20)", "RSI(14)", "Close > SMA200", "ADX14 > 25",
    "Close > Open", "Volume > 1.5 * SMA_Vol20", "RSI14 > 40", "All Conditions Met"
]

# Create or open Calculation sheet
try:
    calc_sheet = workbook.worksheet('Calculation')
    logger.info("Opened Calculation sheet")
except gspread.WorksheetNotFound:
    calc_sheet = workbook.add_worksheet(title='Calculation', rows=100, cols=15)
    calc_sheet.update('A1:O1', [headers])
    logger.info("Created Calculation sheet and set headers")

# Manual RSI calculation
def calculate_rsi(close, period=14):
    delta = close.diff(1)
    gain = np.where(delta > 0, delta, 0)
    loss = np.where(delta < 0, -delta, 0)
    avg_gain = pd.Series(gain).rolling(window=period, min_periods=1).mean()
    avg_loss = pd.Series(loss).rolling(window=period, min_periods=1).mean()
    rs = avg_gain / avg_loss.replace(0, np.finfo(float).eps)
    return float(100 - (100 / (1 + rs.iloc[-1])))

# Manual ADX calculation
def calculate_adx(high, low, close, period=14):
    tr = pd.concat([high - low, (high - close.shift(1)).abs(), (low - close.shift(1)).abs()], axis=1).max(axis=1)
    dm_plus = (high - high.shift(1)).where((high - high.shift(1) > low.shift(1) - low) & (high - high.shift(1) > 0), 0)
    dm_minus = (low.shift(1) - low).where((low.shift(1) - low > high - high.shift(1)) & (low.shift(1) - low > 0), 0)
    atr = tr.ewm(span=period, adjust=False).mean()
    di_plus = 100 * (dm_plus.ewm(span=period, adjust=False).mean() / atr.replace(0, np.finfo(float).eps))
    di_minus = 100 * (dm_minus.ewm(span=period, adjust=False).mean() / atr.replace(0, np.finfo(float).eps))
    dx = 100 * abs(di_plus - di_minus) / (di_plus + di_minus).replace(0, np.finfo(float).eps)
    return float(dx.ewm(span=period, adjust=False).mean().iloc[-1])

# Function to fetch and calculate stock data
def get_stock_data(symbol):
    try:
        stock = yf.Ticker(symbol)
        hist = stock.history(period="1y", interval="1d", auto_adjust=False, prepost=False)
        
        if hist.empty or len(hist) < 200:
            return None, symbol
        
        latest_close = float(hist['Close'].iloc[-1])
        sma_200 = float(hist['Close'].rolling(window=200).mean().iloc[-1])
        adx_14 = calculate_adx(hist['High'], hist['Low'], hist['Close'])
        latest_open = float(hist['Open'].iloc[-1])
        latest_volume = int(hist['Volume'].iloc[-1])
        sma_vol_20 = float(hist['Volume'].rolling(window=20).mean().iloc[-1])
        rsi_14 = calculate_rsi(hist['Close'])
        
        if pd.isna(sma_200) or pd.isna(sma_vol_20):
            logger.warning(f"Missing SMA data for {symbol}")
            return None, symbol

        close_gt_sma200 = "Yes" if latest_close > sma_200 else "No"
        adx_gt_25 = "Yes" if adx_14 > 25 else "No"
        close_gt_open = "Yes" if latest_close > latest_open else "No"
        vol_gt_1_5_sma = "Yes" if latest_volume > 1.5 * sma_vol_20 else "No"
        rsi_gt_40 = "Yes" if rsi_14 > 40 else "No"
        all_conditions_met = "Yes" if all([close_gt_sma200 == "Yes", adx_gt_25 == "Yes", 
                                         close_gt_open == "Yes", vol_gt_1_5_sma == "Yes", 
                                         rsi_gt_40 == "Yes"]) else "No"

        return [symbol[:-3], symbol, latest_close, sma_200, adx_14, latest_open,
                latest_volume, sma_vol_20, rsi_14, close_gt_sma200, adx_gt_25,
                close_gt_open, vol_gt_1_5_sma, rsi_gt_40, all_conditions_met], symbol
    except Exception as e:
        logger.error(f"Error fetching data for {symbol}: {e}")
        return None, symbol

# Test with a known valid symbol
logger.info("Testing data fetch with RELIANCE.NS...")
test_data, _ = get_stock_data("RELIANCE.NS")
if test_data:
    logger.info(f"Test fetch successful: {test_data}")
else:
    logger.error("Test fetch failed for RELIANCE.NS. Check yfinance connectivity or API status.")

# Batch update data for Calculation sheet
batch_data = []
start_row = 4

# Parallel processing of stock symbols
with ThreadPoolExecutor(max_workers=10) as executor:  # Reduced to 10 to avoid rate limits
    future_to_symbol = {}
    for symbol in stock_symbols:
        future = executor.submit(get_stock_data, f"{symbol}.NS")
        future_to_symbol[future] = symbol
        time.sleep(0.5)  # Increased delay to avoid rate limits
    for future in as_completed(future_to_symbol):
        try:
            data, symbol = future.result()
            if data:
                batch_data.append(data)
            else:
                logger.warning(f"No valid data returned for {symbol}")
        except Exception as e:
            logger.error(f"Error processing result for {future_to_symbol[future]}: {e}")

# Update Calculation sheet
if batch_data:
    try:
        calc_sheet.update(f'B{start_row}:P{start_row + len(batch_data) - 1}', batch_data)
        logger.info(f"Updated Calculation sheet with {len(batch_data)} rows")
        
        time.sleep(3)  # Wait for the update to complete
        
    except Exception as e:
        logger.error(f"Error updating Calculation sheet: {e}")
else:
    logger.warning("No data to update in Calculation sheet")

# Fetch data for email just before preparation
try:
    swing_stock_sheet = workbook.worksheet('Swing_stock')
    swing_high_break_sheet = workbook.worksheet('swing today high break')
    credential_sheet = workbook.worksheet('credential')
    swing_stock_data = swing_stock_sheet.get_all_values()
    swing_high_break_data = swing_high_break_sheet.get_all_values()
    email_column = credential_sheet.col_values(4)
    recipients = [email for email in email_column[2:] if email]
    swing_stock_names = [row[1] for row in swing_stock_data[3:] if row[1]]
    logger.info(f"Retrieved {len(swing_stock_names)} stock names from Swing_stock: {swing_stock_names[:5]}...")
    logger.info(f"Retrieved {len(recipients)} recipient emails from credential sheet")
except Exception as e:
    logger.error(f"Error fetching sheet data for email: {e}")
    exit(1)

# Display fetched sheet data before email preparation in a professional format
print("\n" + "-"*60)
print("Sheet Data Summary (Before Email Preparation)".center(60))
print("-"*60)
if swing_stock_data:
    print("Swing Stock Data:")
    for i, row in enumerate(swing_stock_data, 1):
        print(f"Row {i:2d}: {' | '.join(str(val).ljust(15) for val in row)}")
else:
    print("No data in Swing_stock sheet")
if swing_high_break_data:
    print("\nSwing Today High Break Data:")
    for i, row in enumerate(swing_high_break_data, 1):
        print(f"Row {i:2d}: {' | '.join(str(val).ljust(15) for val in row)}")
else:
    print("\nNo data in swing today high break sheet")
if swing_stock_names:
    print("\nSwing Stock Names (Column B):")
    for i, name in enumerate(swing_stock_names, 1):
        print(f"Item {i:2d}: {name.ljust(15)}")
else:
    print("\nNo stock names found in Swing_stock column B")
print("-"*60 + "\n")

# Build HTML table/grid for Swing_stock and swing today high break
swing_stock_headers = ''.join(f'<th style="padding: 12px; text-align: left; font-weight: 600; background-color: #e9ecef; border: 1px solid #dee2e6; color: #343a40;">{col}</th>' for col in swing_stock_data[0])
swing_stock_rows = ''.join(
    '<tr>' + ''.join(f'<td style="padding: 12px; border: 1px solid #dee2e6; background-color: {"#ffffff" if i % 2 == 0 else "#f8f9fa"}; color: #495057;">{val}</td>' for val in row) + '</tr>'
    for i, row in enumerate(swing_stock_data[1:], 1)
)
swing_high_break_headers = ''.join(f'<th style="padding: 12px; text-align: left; font-weight: 600; background-color: #e9ecef; border: 1px solid #dee2e6; color: #343a40;">{col}</th>' for col in swing_high_break_data[0])
swing_high_break_rows = ''.join(
    '<tr>' + ''.join(f'<td style="padding: 12px; border: 1px solid #dee2e6; background-color: {"#ffffff" if i % 2 == 0 else "#f8f9fa"}; color: #495057;">{val}</td>' for val in row) + '</tr>'
    for i, row in enumerate(swing_high_break_data[1:], 1)
)
swing_stock_names_html = ''.join(
    f'<li style="padding: 10px; background-color: #fff; margin: 8px 0; border-left: 4px solid #dc3545; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">{stock}</li>'
    for stock in swing_stock_names
)

# HTML email template
export_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=xlsx"
generated_time = datetime.now(ist).strftime('%Y-%m-%d %H:%M:%S') + ' IST'
html_body_template = """
<html>
  <head>
    <style>
      body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; line-height: 1.6; background-color: #f4f4f4; margin: 0; padding: 20px; }
      .container { max-width: 800px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
      h3 { color: #2c3e50; margin-top: 30px; border-bottom: 2px solid #007bff; padding-bottom: 8px; }
      p { margin: 10px 0; }
      table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
      ul { list-style: none; padding: 0; }
      .download-btn { display: inline-block; padding: 12px 24px; background-color: #007bff; color: #fff; text-decoration: none; border-radius: 5px; font-weight: 500; transition: background-color 0.3s, transform 0.2s; }
      .download-btn:hover { background-color: #0056b3; transform: translateY(-2px); }
      .footer { margin-top: 30px; text-align: center; color: #6c757d; font-size: 0.9em; }
      @media (max-width: 600px) { .container { padding: 15px; } table { font-size: 0.9em; } }
    </style>
  </head>
  <body>
    <div class="container">
      <p>Dear {recipient_name},</p>
      <p>Generated on: {generated_time}</p>
      <h3>Swing Stock Data</h3>
      <table>{swing_stock_headers}{swing_stock_rows}</table>
      <h3>Swing Today High Break Data</h3>
      <table>{swing_high_break_headers}{swing_high_break_rows}</table>
      <h3>Swing Stock Names (Column B)</h3>
      <ul>{swing_stock_names_html}</ul>
      <p><a href="{export_url}" class="download-btn">Download Excel</a></p>
      <div class="footer">This is an automated report from Swing Stock Alert. For support, contact our team.</div>
    </div>
  </body>
</html>
"""

# SMTP setup
smtp_server = 'smtp.gmail.com'
smtp_port = 587
username = os.environ.get('SMTP_USERNAME')
password = os.environ.get('SMTP_PASSWORD')
sender = '"Swing Stock Alert" <otpsender191@gmail.com>'

# Send email function
def send_email(recipient_email, html_body):
    try:
        with smtplib.SMTP(smtp_server, smtp_port) as s:
            s.starttls()
            s.login(username, password)
            msg = MIMEText(html_body, 'html')
            msg['Subject'] = 'Stock Data Report from Swing_stock and swing today high break'
            msg['From'] = sender
            msg['To'] = recipient_email
            s.sendmail(sender, [recipient_email], msg.as_string())
            logger.info(f"Email sent to {recipient_email}")
            return True
    except Exception as e:
        logger.error(f"Error sending to {recipient_email}: {e}")
        return False

# Prepare and send emails
messages_to_send = []
for recipient_email in recipients:
    recipient_name = recipient_email.split('@')[0].replace('.', ' ').replace('_', ' ').title()
    html_body = html_body_template.format(
        recipient_name=recipient_name,
        generated_time=generated_time,
        swing_stock_headers=swing_stock_headers,
        swing_stock_rows=swing_stock_rows,
        swing_high_break_headers=swing_high_break_headers,
        swing_high_break_rows=swing_high_break_rows,
        swing_stock_names_html=swing_stock_names_html,
        export_url=export_url
    )
    messages_to_send.append((recipient_email, html_body))

# Send emails concurrently
logger.info("Sending emails with Swing_stock and swing today high break data...")
emails_sent = 0
with ThreadPoolExecutor(max_workers=5) as executor:  # Reduced to 5 to avoid Gmail throttling
    results = executor.map(lambda args: send_email(*args), messages_to_send)
    emails_sent = sum(1 for success in results if success)

# Print Swing_stock names
logger.info(f"Swing_stock stock names: {', '.join(swing_stock_names)}")
print(f"Swing_stock stock names: {', '.join(swing_stock_names)}")

# Refresh Google Sheet
response = requests.get(macro_url)
print("Google Sheet refreshed successfully.")

# Log completion
elapsed_time = time.time() - start_time
logger.info(f"Sent {emails_sent} emails successfully. Process completed in {elapsed_time:.2f} seconds.")